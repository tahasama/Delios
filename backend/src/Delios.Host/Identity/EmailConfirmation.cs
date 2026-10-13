using System.Security.Cryptography;
using Delios.Host.Audit;
using Delios.Host.Notifications;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Identity;

/// <summary>Body of confirming an email: the link's token.</summary>
public sealed record ConfirmEmailRequest(string? Token);
/// <summary>Body of asking for the confirmation link again.</summary>
public sealed record ResendConfirmationRequest(string? Email);

/// <summary>
/// An organization registering itself proves its email: while email is on, sign-up sends a link (good for two days)
/// and sign-in waits for it. Nothing is stored: the link carries who it is for, sealed with the application's keys.
/// A password reset proves the address too.
/// </summary>
public static class EmailConfirmation
{
    /// <summary>How long a confirmation link works.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(2);

    /// <summary>Registers <c>POST /api/auth/confirm-email</c> and <c>/confirm-email/resend</c>: open to anyone, rate limited like sign-in.</summary>
    public static void MapEmailConfirmationEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth/confirm-email").WithTags("Auth");
        group.MapPost("", ConfirmAsync).AllowAnonymous().RequireRateLimiting("sign-in");
        group.MapPost("/resend", ResendAsync).AllowAnonymous().RequireRateLimiting("sign-in");
    }

    private static ITimeLimitedDataProtector Links(IDataProtectionProvider protection) =>
        protection.CreateProtector("delios.email.confirm").ToTimeLimitedDataProtector();

    /// <summary>Queues the email with the link. Does not save: the caller does.</summary>
    public static void Send(User user, Notifier notifier, IDataProtectionProvider protection)
    {
        var token = Links(protection).Protect($"{user.TenantId:N}|{user.Id:N}", Lifetime);
        var link = notifier.Url($"/confirm-email?token={Uri.EscapeDataString(token)}");
        notifier.Queue(user.TenantId, null, EmailKinds.Account, user.Email, user.Name, "Confirm your email for DELIOS",
            $"Welcome to DELIOS. To confirm that {user.Email} is yours and start, open this link within two days:\n\n{link}\n\n"
            + "If you did not register, ignore this email: nothing happens without it.", "User", user.Id);
    }

    /// <summary><c>POST /api/auth/confirm-email</c>: confirms the address from a valid link; the person then signs in.</summary>
    private static async Task<IResult> ConfirmAsync(ConfirmEmailRequest request, DeliosDbContext db, TenantContext tenant, AuditLog audit,
        IDataProtectionProvider protection, CancellationToken cancellationToken)
    {
        var invalid = Problems.Problem(StatusCodes.Status400BadRequest, "CONFIRM_LINK_INVALID",
            "This link has expired. Sign in to have a new one sent.", null);
        string[] parts;
        try
        {
            parts = Links(protection).Unprotect(request.Token ?? "").Split('|');
        }
        catch (CryptographicException)
        {
            return invalid;
        }
        if (parts.Length != 2 || !Guid.TryParse(parts[0], out var tenantId) || !Guid.TryParse(parts[1], out var userId)) return invalid;
        tenant.Set(tenantId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null) return invalid;
        if (user.EmailToConfirm)
        {
            user.EmailToConfirm = false;
            await db.SaveChangesAsync(cancellationToken);
            await audit.WriteAsync(new Actor(user.Id, user.Name), "EMAIL_CONFIRMED", "User", user.Id, user.Email, cancellationToken: cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// <c>POST /api/auth/confirm-email/resend</c>: sends the link again to an account still waiting for it. Always 204, so
    /// it says nothing about who has an account.
    /// </summary>
    private static async Task<IResult> ResendAsync(ResendConfirmationRequest request, DeliosDbContext db, TenantContext tenant,
        Notifier notifier, IDataProtectionProvider protection, CancellationToken cancellationToken)
    {
        var normalized = (request.Email ?? "").Trim().ToUpperInvariant();
        if (normalized.Length == 0) return Results.NoContent();
        var organization = await db.Tenants.AsNoTracking()
            .Where(t => t.Active && db.SignInNames.Any(n => n.NormalizedEmail == normalized && n.TenantId == t.Id))
            .SingleOrDefaultAsync(cancellationToken);
        if (organization is null) return Results.NoContent();
        tenant.Set(organization.Id);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.NormalizedEmail == normalized && u.Active && u.EmailToConfirm, cancellationToken);
        if (user is null) return Results.NoContent();
        Send(user, notifier, protection);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.NoContent();
    }
}
