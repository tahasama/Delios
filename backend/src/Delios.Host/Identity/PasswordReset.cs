using System.Security.Cryptography;
using Delios.Host.Audit;
using Delios.Host.Notifications;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Identity;

/// <summary>Body of "forgot password": the email of the account.</summary>
public sealed record ForgotPasswordRequest(string? Email);
/// <summary>Body of the reset itself: the link's token and the new password.</summary>
public sealed record ResetPasswordRequest(string? Token, string? Password);

/// <summary>
/// "Forgot password": a link sent by email, good for 30 minutes and once. Nothing is stored: the link carries who it is
/// for and a fingerprint of the password it replaces, sealed with the application's keys, so it stops working as soon as
/// the password changes, by this link or any other way. The answer never says whether an account exists. Two-step
/// sign-in still applies at the next sign-in: a reset changes the password, nothing else.
/// </summary>
public static class PasswordReset
{
    /// <summary>How long a reset link works.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(30);
    /// <summary>The shortest password accepted, as everywhere else.</summary>
    public const int MinLength = 8;

    /// <summary>Registers <c>POST /api/auth/password/forgot</c> and <c>/reset</c>: open to anyone, rate limited like sign-in.</summary>
    public static void MapPasswordResetEndpoints(this IEndpointRouteBuilder app)
    {
        var password = app.MapGroup("/api/auth/password").WithTags("Auth");
        password.MapPost("/forgot", ForgotAsync).AllowAnonymous().RequireRateLimiting("sign-in");
        password.MapPost("/reset", ResetAsync).AllowAnonymous().RequireRateLimiting("sign-in");
    }

    private static ITimeLimitedDataProtector Links(IDataProtectionProvider protection) =>
        protection.CreateProtector("delios.password.reset").ToTimeLimitedDataProtector();

    /// <summary>A fingerprint of the current password: a link made before a change no longer matches.</summary>
    private static string Stamp(User user) =>
        Convert.ToHexStringLower(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(user.PasswordHash)))[..16];

    /// <summary>
    /// <c>POST /api/auth/password/forgot</c>: emails a reset link to the account with that address, when there is one that
    /// may sign in with a password. Always answers 204, so it cannot be used to find out who has an account.
    /// </summary>
    private static async Task<IResult> ForgotAsync(
        ForgotPasswordRequest request, DeliosDbContext db, TenantContext tenant, Notifier notifier, AuditLog audit,
        IDataProtectionProvider protection, CancellationToken cancellationToken)
    {
        var normalized = (request.Email ?? "").Trim().ToUpperInvariant();
        if (normalized.Length == 0) return Results.NoContent();
        var organization = await db.Tenants.AsNoTracking()
            .Where(t => t.Active && db.SignInNames.Any(n => n.NormalizedEmail == normalized && n.TenantId == t.Id))
            .SingleOrDefaultAsync(cancellationToken);
        if (organization is null) return Results.NoContent();

        tenant.Set(organization.Id);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var user = await db.Users.Include(u => u.Party).AsNoTracking()
            .SingleOrDefaultAsync(u => u.NormalizedEmail == normalized, cancellationToken);
        if (user is null || !user.Active || user.Party is { Active: false }) return Results.NoContent();
        // Signing in through the organization's own provider: there is no password here to reset.
        if (!organization.PasswordSignIn && !user.IsAdmin) return Results.NoContent();

        var token = Links(protection).Protect($"{user.TenantId:N}|{user.Id:N}|{Stamp(user)}", Lifetime);
        var link = notifier.Url($"/reset-password?token={Uri.EscapeDataString(token)}");
        notifier.Queue(user.TenantId, null, EmailKinds.Account, user.Email, user.Name, "Reset your DELIOS password",
            $"Someone asked to reset the password of your DELIOS account ({user.Email}).\n\n" +
            $"To choose a new password, open this link within {Lifetime.TotalMinutes:0} minutes. It works once.\n\n{link}\n\n" +
            "If it was not you, ignore this email: your password stays as it is.",
            "User", user.Id);
        await audit.WriteAsync(new Actor(user.Id, user.Name), "PASSWORD_RESET_ASKED", "User", user.Id, user.Email,
            cancellationToken: cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// <c>POST /api/auth/password/reset</c>: sets the new password from a valid link. Unlocks the account and ends every
    /// session it had, so whoever might have been using it is signed out.
    /// </summary>
    private static async Task<IResult> ResetAsync(
        ResetPasswordRequest request, DeliosDbContext db, TenantContext tenant, SessionStore sessions, AuditLog audit,
        IPasswordHasher<User> hasher, IDataProtectionProvider protection, CancellationToken cancellationToken)
    {
        var invalid = Problems.Problem(StatusCodes.Status400BadRequest, "RESET_LINK_INVALID",
            "This link has expired or was already used. Ask for a new one.", null);
        if ((request.Password ?? "").Length < MinLength)
            return Problems.Invalid("PASSWORD_TOO_SHORT", $"A password has at least {MinLength} characters.");

        string[] parts;
        try
        {
            parts = Links(protection).Unprotect(request.Token ?? "").Split('|');
        }
        catch (CryptographicException)
        {
            return invalid;
        }
        if (parts.Length != 3 || !Guid.TryParse(parts[0], out var tenantId) || !Guid.TryParse(parts[1], out var userId)) return invalid;

        tenant.Set(tenantId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var organization = await db.Tenants.AsNoTracking().SingleOrDefaultAsync(t => t.Id == tenantId && t.Active, cancellationToken);
        var user = await db.Users.Include(u => u.Party).SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (organization is null || user is null || !user.Active || user.Party is { Active: false } || Stamp(user) != parts[2]) return invalid;
        if (!organization.PasswordSignIn && !user.IsAdmin) return invalid;

        user.PasswordHash = hasher.HashPassword(user, request.Password!);
        user.FailedSignIns = 0;
        user.LockedUntil = null;
        await db.SaveChangesAsync(cancellationToken);
        await sessions.ForgetAllAsync(user.Id, revoke: true, cancellationToken);
        await audit.WriteAsync(new Actor(user.Id, user.Name), "PASSWORD_RESET", "User", user.Id, user.Email,
            cancellationToken: cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.NoContent();
    }
}
