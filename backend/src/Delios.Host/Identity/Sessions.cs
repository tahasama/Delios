using System.Security.Cryptography;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Hybrid;
using NodaTime;

namespace Delios.Host.Identity;

/// <summary>What a valid session says. Plain types only: it is cached in Redis as JSON.</summary>
public sealed record SessionInfo(Guid SessionId, Guid TenantId, Guid UserId, string UserName, bool IsAdmin, DateTimeOffset ExpiresAt);

/// <summary>
/// Sessions live in Postgres, so any node can check them and signing out ends
/// them everywhere. Checks are cached for at most 30 seconds.
/// </summary>
public sealed class SessionStore(DeliosDbContext db, TenantContext tenant, HybridCache cache, IClock clock)
{
    public static readonly Duration Lifetime = Duration.FromHours(12);
    private static readonly HybridCacheEntryOptions CacheFor = new()
    {
        Expiration = TimeSpan.FromSeconds(30),
        LocalCacheExpiration = TimeSpan.FromSeconds(30),
    };

    public async Task<(string Token, Instant ExpiresAt)> CreateAsync(User user, CancellationToken cancellationToken)
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var expires = clock.GetCurrentInstant() + Lifetime;
        db.Sessions.Add(new Session
        {
            TokenHash = Hash(token),
            TenantId = user.TenantId,
            UserId = user.Id,
            ExpiresAt = expires,
        });
        await db.SaveChangesAsync(cancellationToken);
        return (token, expires);
    }

    public async Task<SessionInfo?> FindAsync(string token, CancellationToken cancellationToken)
    {
        var hash = Hash(token);
        return await cache.GetOrCreateAsync(Key(hash), async cancel => await LoadAsync(hash, cancel),
            CacheFor, cancellationToken: cancellationToken);
    }

    /// <summary>Pushes the expiry forward once half the lifetime has passed.</summary>
    public async Task<Instant?> RenewIfDueAsync(string token, SessionInfo session, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        if (Instant.FromDateTimeOffset(session.ExpiresAt) - now > Lifetime / 2) return null;
        var expires = now + Lifetime;
        await db.Sessions.Where(s => s.Id == session.SessionId)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.ExpiresAt, expires), cancellationToken);
        await cache.RemoveAsync(Key(Hash(token)), cancellationToken);
        return expires;
    }

    public async Task RevokeAsync(string token, CancellationToken cancellationToken)
    {
        var hash = Hash(token);
        var now = clock.GetCurrentInstant();
        await db.Sessions.Where(s => s.TokenHash == hash && s.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, now), cancellationToken);
        await cache.RemoveAsync(Key(hash), cancellationToken);
    }

    private async Task<SessionInfo?> LoadAsync(byte[] hash, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var session = await db.Sessions.AsNoTracking()
            .Where(s => s.TokenHash == hash && s.RevokedAt == null && s.ExpiresAt > now)
            .SingleOrDefaultAsync(cancellationToken);
        if (session is null) return null;

        // The person is read under their tenant's row-level security.
        tenant.Set(session.TenantId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var person = await db.Users.AsNoTracking()
            .Where(u => u.Id == session.UserId && u.Active && (u.Party == null || u.Party.Active))
            .Select(u => new { u.Name, u.IsAdmin })
            .SingleOrDefaultAsync(cancellationToken);
        var tenantActive = await db.Tenants.AnyAsync(t => t.Id == session.TenantId && t.Active, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return person is null || !tenantActive
            ? null
            : new SessionInfo(session.Id, session.TenantId, session.UserId, person.Name, person.IsAdmin, session.ExpiresAt.ToDateTimeOffset());
    }

    private static byte[] Hash(string token) => SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token));
    private static string Key(byte[] hash) => "session:" + Convert.ToHexString(hash);
}
