using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Delios.Host.Seeding;

/// <summary>Body of an organization registering itself. The project is optional: an organization exists before its projects do.</summary>
public sealed record SignUpRequest(
    string? OrganizationName, string? Name, string? Email, string? Password, string? ProjectCode = null, string? ProjectName = null,
    string? ContractRole = null, string? ProjectKind = null);

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
        AuditLog audit, IOptions<SessionCookieOptions> cookie, CancellationToken cancellationToken)
    {
        if (!configuration.GetValue("SignUp:Enabled", false)) return Results.NotFound();
        var organization = request.OrganizationName?.Trim() ?? "";
        var name = request.Name?.Trim() ?? "";
        var email = request.Email?.Trim().ToLowerInvariant() ?? "";
        var password = request.Password ?? "";
        if (organization.Length == 0) return Problems.Invalid("ORGANIZATION_REQUIRED", "Your organization needs a name.");
        if (name.Length == 0 || !email.Contains('@')) return Problems.Invalid("NAME_AND_EMAIL_REQUIRED", "Your name and email are required.");
        if (password.Length < 8) return Problems.Invalid("PASSWORD_TOO_SHORT", "The password must be at least 8 characters.");
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
        await IdentityEndpoints.IssueAsync(http, admin, "SIGN_UP", sessions, audit, cookie.Value, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.NoContent();
    }
}
