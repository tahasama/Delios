using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Tenancy;

/// <summary>
/// The one explicit door across organizations on the tables shared by every organization (migration FenceSharedTables):
/// inside an organization's transaction those tables show and take only its own rows, unless the code says it crosses,
/// here, until the transaction ends. Code with no organization set (before sign-in, the worker, the console, a command)
/// is not fenced, as before.
/// </summary>
public static class Crossing
{
    /// <summary>Opens the door for the rest of the current transaction.</summary>
    public static Task OpenAsync(DeliosDbContext db, CancellationToken cancellationToken) =>
        db.Database.ExecuteSqlRawAsync("SELECT set_config('app.crossing', 'on', true)", cancellationToken);
}
