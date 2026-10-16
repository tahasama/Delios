using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Seeding;

/// <summary>
/// <c>grant-all &lt;email&gt;</c>: gives one person every right in their organization, for the app's owner.
/// The person is made an administrator, unlocked and reactivated, and put on every project with the
/// organization's control function (the first function holding Control); that function is given
/// every verb it lacks, so rights added since it was made (Plan, for one) are there too. With
/// DELIOS_ADMIN_PASSWORD set, the password is replaced and two-step sign-in is turned off. Logged.
/// </summary>
public sealed class GrantAll(DeliosDbContext db, TenantContext tenant, AuditLog audit, IPasswordHasher<User> hasher)
{
    public async Task<string> RunAsync(string email, string? password, CancellationToken cancellationToken = default)
    {
        var normalized = email.Trim().ToUpperInvariant();
        var name = await db.SignInNames.AsNoTracking().SingleOrDefaultAsync(n => n.NormalizedEmail == normalized, cancellationToken);
        if (name is null) return $"No one signs in as {email}.";
        tenant.Set(name.TenantId);

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var user = await db.Users.SingleAsync(u => u.NormalizedEmail == normalized, cancellationToken);
        user.IsAdmin = true;
        user.Active = true;
        user.FailedSignIns = 0;
        user.LockedUntil = null;
        if (password is not null)
        {
            user.PasswordHash = hasher.HashPassword(user, password);
            user.MfaSecretProtected = null;
            user.MfaEnabledAt = null;
            user.MfaLastStep = null;
            user.RecoveryCodeHashes = [];
        }

        var control = await db.Functions.Include(f => f.Rules)
            .Where(f => f.Active && f.Rules.Any(r => r.Verbs.Contains(Verbs.Control)))
            .OrderBy(f => f.Code).FirstOrDefaultAsync(cancellationToken);
        if (control is null) return "No function holds Control in this organization; give a function the Control permission in Settings first.";
        var everywhere = control.Rules.FirstOrDefault(r => r.DeliverableType == null && r.DocType == null && r.Discipline == null
            && r.Criticality == null && r.Confidentiality == null && r.ProjectRole == null);
        if (everywhere is null)
        {
            everywhere = new PermissionRule { TenantId = name.TenantId, FunctionId = control.Id };
            db.Add(everywhere);
        }
        var added = Verbs.All.Except(everywhere.Verbs).ToArray();
        everywhere.Verbs = [.. everywhere.Verbs.Union(Verbs.All)];

        var projects = await db.Projects.Select(p => p.Id).ToListAsync(cancellationToken);
        var memberships = await db.Memberships.Where(m => m.UserId == user.Id).ToListAsync(cancellationToken);
        foreach (var projectId in projects)
        {
            var seat = memberships.FirstOrDefault(m => m.ProjectId == projectId);
            if (seat is null) db.Memberships.Add(new Membership { TenantId = name.TenantId, ProjectId = projectId, UserId = user.Id, FunctionId = control.Id });
            else seat.FunctionId = control.Id;
        }
        await db.SaveChangesAsync(cancellationToken);
        var said = $"{user.Name} ({user.Email}) is an administrator, unlocked, and {control.Name} on all {projects.Count} projects."
            + (added.Length > 0 ? $" {control.Name} was given {string.Join(", ", added)}." : "")
            + (password is not null ? " Password replaced; two-step sign-in turned off." : "");
        await audit.WriteAsync(Actor.System, "GRANT_ALL", "User", user.Id, user.Email, said, null, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return said;
    }
}
