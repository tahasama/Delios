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
public sealed record ResendConfirmationRequest(string? Email, string? Turnstile = null);

/// <summary>
/// An organization registering itself proves its email: while email is on, sign-up sends a link (good for two days)
/// and sign-in waits for it. Nothing is stored: the link carries who it is for, sealed with the application's keys.
/// A password reset proves the address too. A new email given to someone by an administrator counts only once its
/// owner opens the link sent to it (owner): until then the account keeps the email it had, which is told of the change.
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

    /// <summary>
    /// Queues the link that makes <paramref name="newEmail"/> this person's email once opened, and a word to the address
    /// they have now. Does not save: the caller does. Returns the link, to hand over where email is off.
    /// </summary>
    public static string SendChange(User user, string newEmail, string askedBy, Notifier notifier, IDataProtectionProvider protection)
    {
        var token = Links(protection).Protect($"{user.TenantId:N}|{user.Id:N}|{user.NormalizedEmail}|{newEmail}", Lifetime);
        var link = notifier.Url($"/confirm-email?token={Uri.EscapeDataString(token)}");
        notifier.Queue(user.TenantId, null, EmailKinds.Account, newEmail, user.Name, "Confirm your new email for DELIOS",
            $"{askedBy} gave {newEmail} as your email on DELIOS. If it is yours, open this link within two days:\n\n{link}\n\n"
            + $"Until then you keep signing in with {user.Email}. If you do not know what this is, ignore this email: nothing changes without it.",
            "User", user.Id);
        notifier.Queue(user.TenantId, null, EmailKinds.Account, user.Email, user.Name, "Your email on DELIOS may change",
            $"{askedBy} gave {newEmail} as your email on DELIOS. It changes only once the link sent there is opened; "
            + $"until then you sign in with {user.Email}, as now.", "User", user.Id);
        return link;
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
        if (parts.Length is not (2 or 4) || !Guid.TryParse(parts[0], out var tenantId) || !Guid.TryParse(parts[1], out var userId)) return invalid;
        tenant.Set(tenantId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null) return invalid;
        if (parts.Length == 4)
        {
            // A new email asked by an administrator: it counts now, if the account still has the email it had then.
            var (was, email) = (parts[2], parts[3]);
            if (user.NormalizedEmail != was)
                return Problems.Problem(StatusCodes.Status400BadRequest, "CONFIRM_LINK_INVALID",
                    "This link no longer applies: the email was changed since. Ask your administrator.", null);
            var normalized = email.ToUpperInvariant();
            if (await db.SignInNames.AnyAsync(n => n.NormalizedEmail == normalized, cancellationToken))
                return Problems.Conflict("EMAIL_TAKEN", $"{email} already signs somebody in. Ask your administrator.");
            var before = user.Email;
            user.Email = email;
            user.NormalizedEmail = normalized;
            user.EmailToConfirm = false;
            await db.SaveChangesAsync(cancellationToken);
            await audit.WriteAsync(new Actor(user.Id, user.Name), "EMAIL_CHANGED", "User", user.Id, user.Name,
                $"email: {before} → {email}, confirmed by its owner", cancellationToken: cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Results.Ok(new { email });
        }
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
    private static async Task<IResult> ResendAsync(ResendConfirmationRequest request, HttpContext http, DeliosDbContext db, TenantContext tenant,
        Notifier notifier, IDataProtectionProvider protection, BotCheck bots, CancellationToken cancellationToken)
    {
        if (await bots.RefusalAsync(request.Turnstile, http, cancellationToken) is { } robot) return robot;
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
