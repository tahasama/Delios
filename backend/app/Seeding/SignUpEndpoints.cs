using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Delios.Host.Seeding;

/// <summary>Body of an organization registering itself. The project is optional: an organization exists before its projects do.</summary>
public sealed record SignUpRequest(
    string? OrganizationName, string? Name, string? Email, string? Password, string? ProjectCode = null, string? ProjectName = null,
    string? ContractRole = null, string? ProjectKind = null, string? Turnstile = null, bool TakeGuestAccount = false);

/// <summary>
/// The one self-service way in: an organization registers itself, with its first administrator and the recommended
/// configuration, and the administrator is signed in. Every account after that one is created by them. Switched on
/// with <c>SignUp:Enabled</c>; off, the endpoint answers 404 and organizations are created with the
/// <c>create-tenant</c> command.
/// </summary>
public static class SignUpEndpoints
{
    public static void MapSignUpEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/auth/sign-up", SignUpAsync).WithTags("Auth").AllowAnonymous().RequireRateLimiting("sign-in");
    }

    private static async Task<IResult> SignUpAsync(
        SignUpRequest request, HttpContext http, IConfiguration configuration, DeliosDbContext db, DemoSeed starter, SessionStore sessions,
        AuditLog audit, IOptions<SessionCookieOptions> cookie, PasswordPolicy passwords, IOptions<Notifications.EmailOptions> mail,
        Notifications.Notifier notifier, Microsoft.AspNetCore.DataProtection.IDataProtectionProvider protection, BotCheck bots,
        IServiceScopeFactory scopes, Microsoft.AspNetCore.Identity.IPasswordHasher<User> hasher, CancellationToken cancellationToken)
    {
        if (!configuration.GetValue("SignUp:Enabled", false)) return Results.NotFound();
        if (await bots.RefusalAsync(request.Turnstile, http, cancellationToken) is { } robot) return robot;
        var organization = request.OrganizationName?.Trim() ?? "";
        var name = request.Name?.Trim() ?? "";
        var email = request.Email?.Trim().ToLowerInvariant() ?? "";
        var password = request.Password ?? "";
        if (organization.Length == 0) return Problems.Invalid("ORGANIZATION_REQUIRED", "Your organization needs a name.");
        if (name.Length == 0 || !email.Contains('@')) return Problems.Invalid("NAME_AND_EMAIL_REQUIRED", "Your name and email are required.");
        // A guest's email (an account another organization made for them): they may take it into their own DELIOS.
        var normalizedEmail = email.ToUpperInvariant();
        var signsIn = await db.SignInNames.AsNoTracking().Where(n => n.NormalizedEmail == normalizedEmail).Select(n => (Guid?)n.TenantId)
            .SingleOrDefaultAsync(cancellationToken);
        if (signsIn is { } guestHost)
        {
            var (account, hostName) = await Tenancy.TenantScope.RunAsync(scopes, guestHost, async (_, there) =>
            {
                var user = await there.Users.AsNoTracking().Include(u => u.Party)
                    .SingleOrDefaultAsync(u => u.TenantId == guestHost && u.NormalizedEmail == normalizedEmail && u.HomeTenantId == null, cancellationToken);
                var hostName = await there.Tenants.AsNoTracking().Where(t => t.Id == guestHost).Select(t => t.Name).SingleAsync(cancellationToken);
                return (user is { Party.IsInternal: false, IsAdmin: false } ? user : null, hostName);
            }, cancellationToken);
            if (account is not null)
            {
                if (!request.TakeGuestAccount)
                    return Problems.Conflict("GUEST_ACCOUNT",
                        $"{email} is the account {hostName} made for you, for {account.Party!.Name}. Create {account.Party.Name}'s own DELIOS and take "
                        + $"it with you: give that account's password. You keep every project you are on at {hostName}.",
                        new { host = hostName, organization = account.Party.Name });
                if (hasher.VerifyHashedPassword(account, account.PasswordHash, password) == Microsoft.AspNetCore.Identity.PasswordVerificationResult.Failed)
                    return Problems.Invalid("PASSWORD_WRONG", $"That is not the password of your account at {hostName}.", new { field = "password" });
                if (IncompleteProject(request) is { } incomplete) return incomplete;
                return await TakeGuestAccountAsync(request, organization, name, email, password, account, guestHost, hostName, db, scopes,
                    cancellationToken);
            }
        }
        if (await passwords.RefusalAsync(password, cancellationToken) is { } weak) return weak;
        var wantsProject = !string.IsNullOrWhiteSpace(request.ProjectCode) || !string.IsNullOrWhiteSpace(request.ProjectName);
        if (wantsProject && (string.IsNullOrWhiteSpace(request.ProjectCode) || string.IsNullOrWhiteSpace(request.ProjectName)))
            return Problems.Invalid("PROJECT_INCOMPLETE", "Name the project and give it a code, or leave both empty to open it later.");
        // A person belongs to one organization: their email signs them in to it alone.
        var normalized = email.ToUpperInvariant();
        if (await db.SignInNames.AnyAsync(n => n.NormalizedEmail == normalized, cancellationToken))
            return Problems.Conflict("EMAIL_TAKEN", "That email already signs somebody in. Sign in instead.");

        var (_, adminId) = await starter.StartAsync(organization, name, email, password, request.ProjectCode, request.ProjectName,
            request.ContractRole, cancellationToken, request.ProjectKind);
        // Read back under the new organization's row-level security, which applies inside a transaction.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var admin = await db.Users.SingleAsync(u => u.Id == adminId, cancellationToken);
        // With email on, the address is proved before anyone signs in with it.
        if (mail.Value.Enabled)
        {
            admin.EmailToConfirm = true;
            EmailConfirmation.Send(admin, notifier, protection);
            await db.SaveChangesAsync(cancellationToken);
            await audit.WriteAsync(new Actor(admin.Id, admin.Name), "SIGN_UP", "User", admin.Id, admin.Email,
                "Waiting for the email to be confirmed.", cancellationToken: cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Results.Accepted(value: new { next = "CONFIRM_EMAIL" });
        }
        await IdentityEndpoints.IssueAsync(http, admin, "SIGN_UP", sessions, audit, cookie.Value, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.NoContent();
    }

    private static IResult? IncompleteProject(SignUpRequest request) =>
        string.IsNullOrWhiteSpace(request.ProjectCode) != string.IsNullOrWhiteSpace(request.ProjectName)
            ? Problems.Invalid("PROJECT_INCOMPLETE", "Name the project and give it a code, or leave both empty to open it later.")
            : null;

    /// <summary>
    /// A guest makes their organization's own DELIOS with the account another organization made for them (owner): the
    /// password of that account proves it is them, so the entry that organization recorded is theirs at once (a claim
    /// confirmed). They are its administrator, with the same email, password and two-step sign-in; the two
    /// organizations are linked by themselves and the old account stands for them on the projects they were on
    /// (<see cref="Organizations.ClaimLinking"/>). They then sign in as usual, at home.
    /// </summary>
    private static async Task<IResult> TakeGuestAccountAsync(SignUpRequest request, string organization, string name, string email, string password,
        User guest, Guid host, string hostName, DeliosDbContext db, IServiceScopeFactory scopes, CancellationToken cancellationToken)
    {
        // The sign-in name leaves the host first: an email signs in to one organization only.
        await db.SignInNames.Where(n => n.NormalizedEmail == guest.NormalizedEmail && n.TenantId == host).ExecuteDeleteAsync(cancellationToken);
        Tenant tenant;
        Guid adminId;
        try
        {
            // In a scope of its own: a failure leaves nothing half-tracked on this request's context.
            await using var scope = scopes.CreateAsyncScope();
            (tenant, adminId) = await scope.ServiceProvider.GetRequiredService<DemoSeed>().StartAsync(organization, name, email, password,
                request.ProjectCode, request.ProjectName, request.ContractRole, cancellationToken, request.ProjectKind);
        }
        catch
        {
            // Nothing was made: the sign-in name goes back to the account it came from.
            if (!await db.SignInNames.AnyAsync(n => n.NormalizedEmail == guest.NormalizedEmail, cancellationToken))
                await db.Database.ExecuteSqlInterpolatedAsync(
                    $"INSERT INTO sign_in_names (normalized_email, tenant_id) VALUES ({guest.NormalizedEmail}, {host})", cancellationToken);
            throw;
        }
        var entryId = guest.Party?.OrganizationId;
        var keepId = await Tenancy.TenantScope.RunAsync(scopes, tenant.Id, async (services, home) =>
        {
            var admin = await home.Users.SingleAsync(u => u.Id == adminId, cancellationToken);
            // Their two-step sign-in comes with them, and their address was proven where it was.
            admin.MfaSecretProtected = guest.MfaSecretProtected;
            admin.MfaEnabledAt = guest.MfaEnabledAt;
            admin.RecoveryCodeHashes = guest.RecoveryCodeHashes;
            admin.EmailToConfirm = false;
            var keep = await home.Parties.AsNoTracking().Where(p => p.TenantId == tenant.Id && p.IsInternal).Select(p => p.OrganizationId).FirstOrDefaultAsync(cancellationToken);
            await home.SaveChangesAsync(cancellationToken);
            await services.GetRequiredService<AuditLog>().WriteAsync(new Actor(admin.Id, admin.Name), "SIGN_UP", "User", admin.Id, admin.Email,
                $"Made {organization}'s own DELIOS with the account {hostName} had made for them.", cancellationToken: cancellationToken);
            return keep;
        }, cancellationToken);
        if (keepId is { } keepIdentity && entryId is { } entry && keepIdentity != entry)
        {
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            var keep = await db.OrganizationIdentities.SingleAsync(x => x.Id == keepIdentity, cancellationToken);
            var recorded = await db.OrganizationIdentities.SingleOrDefaultAsync(x => x.Id == entry && x.MergedIntoId == null && x.TenantId == null, cancellationToken);
            if (recorded is not null)
            {
                var now = NodaTime.SystemClock.Instance.GetCurrentInstant();
                db.OrganizationClaims.Add(new Organizations.OrganizationClaim
                {
                    EntryId = recorded.Id, ClaimerTenantId = tenant.Id, ClaimerIdentityId = keep.Id, ClaimedByName = name, MakerTenantId = host,
                    Method = Organizations.ClaimMethods.GuestEmail, SentTo = email, State = Organizations.ClaimStates.Confirmed,
                    CreatedAt = now, AnsweredAt = now, AnsweredByName = email,
                });
                await Organizations.Registry.MergeAsync(db, scopes, keep, recorded, cancellationToken);
                await db.SaveChangesAsync(cancellationToken);
            }
            await transaction.CommitAsync(cancellationToken);
        }
        Guid[] ids = [.. new[] { keepId, entryId }.Where(x => x is not null).Select(x => x!.Value).Distinct()];
        if (ids.Length > 0) await Organizations.ClaimLinking.LinkAsync(scopes, tenant.Id, ids, $"{name}, its guest at {hostName}", cancellationToken);
        return Results.Accepted(value: new { next = "SIGN_IN", organization, host = hostName });
    }
}
