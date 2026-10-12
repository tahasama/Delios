using Delios.Host.Audit;
using Delios.Host.Packages;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Seeding;

/// <summary>
/// <c>unshare-package &lt;email&gt; &lt;package-number&gt;</c>: for the app's owner testing, puts a supplier's package back to
/// not shared, so it can be shared again. The organization is the one the email signs in to. What was sent to the
/// supplier on transmittals stays as it went. Logged.
/// </summary>
public sealed class UnsharePackage(DeliosDbContext db, TenantContext tenant, AuditLog audit)
{
    public async Task<string> RunAsync(string email, string number, CancellationToken cancellationToken = default)
    {
        var normalized = email.Trim().ToUpperInvariant();
        var name = await db.SignInNames.AsNoTracking().SingleOrDefaultAsync(n => n.NormalizedEmail == normalized, cancellationToken);
        if (name is null) return $"No one signs in as {email}.";
        tenant.Set(name.TenantId);
        // The organization is applied when a transaction starts: without one, no row of it is seen.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var wanted = number.Trim().ToUpperInvariant();
        var package = await db.Packages.SingleOrDefaultAsync(p => p.Number == wanted && p.Kind == PackageKinds.Supply, cancellationToken);
        if (package is null) return $"No supplier package numbered {number}.";
        if (package.SharedAt is null) return $"{package.Number} is not shared; nothing to do.";
        package.SharedAt = null;
        package.SharedByName = null;
        await audit.WriteAsync(Actor.System, "PACKAGE_UNSHARED", "Package", package.Id, package.Number,
            "Put back to not shared from the command line, for testing.", package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return $"{package.Number} is no longer shared; share it again from its page.";
    }
}
