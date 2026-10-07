using Delios.Host.Audit;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Identity;

public sealed record SecurityPolicyRequest(bool? MfaRequired = null, bool? PasswordSignIn = null);

/// <param name="ClientSecret">Required the first time; left out afterwards, the stored one is kept.</param>
public sealed record IdentityProviderRequest(
    string? Name, string? Authority, string? ClientId, string? ClientSecret = null, string[]? AllowedDomains = null,
    bool Enabled = true, string? Scopes = null);

/// <summary>How the organization's people sign in: the administrator's choices, switched on when wanted.</summary>
public static class AdminEndpoints
{
    public static void MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/api/admin").WithTags("Administration")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(async (context, next) => context.HttpContext.User.IsAdmin()
                ? await next(context)
                : Problems.Forbidden("ADMIN_ONLY", "Only an administrator changes how the organization signs in."));
        admin.MapGet("/security", GetAsync);
        admin.MapPut("/security", PolicyAsync);
        admin.MapPut("/security/sso", ProviderAsync);
        admin.MapPost("/users/{userId:guid}/mfa/reset", ResetMfaAsync);
    }

    private static async Task<IResult> GetAsync(HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var organization = await db.Tenants.AsNoTracking().SingleAsync(t => t.Id == http.User.TenantId(), cancellationToken);
        var provider = await db.IdentityProviders.AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        var enrolled = await db.Users.CountAsync(u => u.Active && u.MfaEnabledAt != null, cancellationToken);
        var people = await db.Users.CountAsync(u => u.Active, cancellationToken);
        return Results.Ok(new
        {
            organization.MfaRequired,
            organization.PasswordSignIn,
            mfaEnrolled = new { enrolled, of = people },
            sso = provider is null ? null : new
            {
                provider.Name,
                provider.Authority,
                provider.ClientId,
                provider.Scopes,
                provider.AllowedDomains,
                provider.Enabled,
            },
        });
    }

    private static async Task<IResult> PolicyAsync(
        SecurityPolicyRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var organization = await db.Tenants.SingleAsync(t => t.Id == http.User.TenantId(), cancellationToken);
        if (request.PasswordSignIn == false && !await db.IdentityProviders.AnyAsync(p => p.Enabled, cancellationToken))
        {
            return Problems.Conflict("SSO_NOT_CONFIGURED",
                "Set up the organization's identity provider before turning password sign-in off.");
        }
        organization.MfaRequired = request.MfaRequired ?? organization.MfaRequired;
        organization.PasswordSignIn = request.PasswordSignIn ?? organization.PasswordSignIn;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "SECURITY_POLICY_CHANGED", "Tenant", organization.Id, organization.Slug,
            $"Two-step sign-in {(organization.MfaRequired ? "required" : "optional")}; password sign-in {(organization.PasswordSignIn ? "on" : "administrators only")}.",
            cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> ProviderAsync(
        IdentityProviderRequest request, HttpContext http, DeliosDbContext db, IDataProtectionProvider protection,
        AuditLog audit, CancellationToken cancellationToken)
    {
        var name = request.Name?.Trim() ?? "";
        var authority = request.Authority?.Trim().TrimEnd('/') ?? "";
        var clientId = request.ClientId?.Trim() ?? "";
        if (name.Length == 0 || clientId.Length == 0 || !Uri.TryCreate(authority, UriKind.Absolute, out _))
            return Problems.Invalid("SSO_FIELDS_REQUIRED", "A name, the provider's address (its issuer) and the client id are required.");
        var provider = await db.IdentityProviders.SingleOrDefaultAsync(cancellationToken);
        if (provider is null && string.IsNullOrEmpty(request.ClientSecret))
            return Problems.Invalid("SSO_FIELDS_REQUIRED", "The client secret is required the first time.");

        var secret = string.IsNullOrEmpty(request.ClientSecret) ? null
            : SsoEndpoints.SecretProtector(protection).Protect(request.ClientSecret);
        if (provider is null)
        {
            provider = new IdentityProvider
            {
                TenantId = http.User.TenantId(),
                Name = name,
                Authority = authority,
                ClientId = clientId,
                ClientSecretProtected = secret!,
            };
            db.IdentityProviders.Add(provider);
        }
        provider.Name = name;
        provider.Authority = authority;
        provider.ClientId = clientId;
        provider.ClientSecretProtected = secret ?? provider.ClientSecretProtected;
        provider.AllowedDomains = request.AllowedDomains?.Select(d => d.Trim().TrimStart('@').ToLowerInvariant())
            .Where(d => d.Length > 0).Distinct().ToArray() ?? [];
        provider.Scopes = string.IsNullOrWhiteSpace(request.Scopes) ? "openid profile email" : request.Scopes.Trim();
        provider.Enabled = request.Enabled;
        if (!provider.Enabled)
        {
            // Never leave an organization with no way in.
            var organization = await db.Tenants.SingleAsync(t => t.Id == provider.TenantId, cancellationToken);
            organization.PasswordSignIn = true;
        }
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "SSO_CONFIGURED", "IdentityProvider", provider.Id, name,
            $"{authority}, client {clientId}, {(provider.Enabled ? "on" : "off")}.", cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    /// <summary>For a lost phone with no recovery codes left: they enrol again at their next sign-in.</summary>
    private static async Task<IResult> ResetMfaAsync(
        Guid userId, HttpContext http, DeliosDbContext db, AuditLog audit, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null) return Problems.NotFound("USER_NOT_FOUND", "No such person.");
        Mfa.Disable(user);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "MFA_RESET", "User", user.Id, user.Email, cancellationToken: cancellationToken);
        return Results.NoContent();
    }
}
