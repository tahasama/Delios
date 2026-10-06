using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Platform;

public sealed class DeliosDbContext(DbContextOptions<DeliosDbContext> options)
    : DbContext(options), IDataProtectionKeyContext
{
    /// <summary>
    /// The keys that protect cookies and anti-forgery tokens. Shared through the
    /// database so that every node accepts what any other node issued.
    /// </summary>
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();
}
