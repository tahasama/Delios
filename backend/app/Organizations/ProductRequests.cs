using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Notifications;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Organizations;

/// <summary>
/// An organization asking DELIOS for something the app does not carry yet (owner: "a form inside DELIOS that lands with
/// me, and of course an email to delios"): a certified DWG reader, paid. Kept outside any organization's data (no
/// row-level security), so the app's owner reads every ask together (<c>requests</c>, backend command); emailed to
/// DELIOS's own address (<c>Email:DeliosAddress</c>) when one is set.
/// </summary>
public sealed class ProductRequest
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public required string OrganizationName { get; set; }
    /// <summary>What is asked: <see cref="ProductRequests.DwgReader"/>.</summary>
    public required string What { get; set; }
    public string? Message { get; set; }
    public Guid ByUserId { get; set; }
    public required string ByName { get; set; }
    public required string ByEmail { get; set; }
    public Instant At { get; set; }
}

internal sealed class ProductRequestConfiguration : IEntityTypeConfiguration<ProductRequest>
{
    public void Configure(EntityTypeBuilder<ProductRequest> b)
    {
        b.ToTable("product_requests");
        b.Property(x => x.OrganizationName).HasMaxLength(200);
        b.Property(x => x.What).HasMaxLength(32);
        b.Property(x => x.Message).HasMaxLength(2000);
        b.Property(x => x.ByName).HasMaxLength(200);
        b.Property(x => x.ByEmail).HasMaxLength(254);
        b.HasIndex(x => x.TenantId);
    }
}

public static class ProductRequests
{
    /// <summary>A certified DWG reader (paid), in place of the free one.</summary>
    public const string DwgReader = "DWG_READER";
    private static readonly Dictionary<string, string> Words = new() { [DwgReader] = "A certified DWG reader" };

    public sealed record AskRequest(string? What, string? Message);
    public sealed record Asked(Guid Id, string What, string? Message, string ByName, Instant At);

    /// <summary>Registers <c>GET</c> and <c>POST /api/admin/product-requests</c> (administrators).</summary>
    public static void MapProductRequestEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/product-requests").WithTags("Administration").AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Configurers("An administrator asks DELIOS for this."));
        group.MapGet("", ListAsync);
        group.MapPost("", AskAsync);
    }

    /// <summary>Whether the free DWG reader is installed here, and what this organization asked, newest first.</summary>
    private static async Task<IResult> ListAsync(HttpContext http, DeliosDbContext db, IOptions<Documents.PreviewOptions> previews,
        CancellationToken cancellationToken)
    {
        var tenantId = http.User.TenantId();
        var asked = await db.Set<ProductRequest>().AsNoTracking().Where(r => r.TenantId == tenantId).OrderByDescending(r => r.At)
            .Select(r => new Asked(r.Id, r.What, r.Message, r.ByName, r.At)).ToListAsync(cancellationToken);
        return Results.Ok(new { freeReader = !string.IsNullOrWhiteSpace(previews.Value.DwgUrl), asked });
    }

    /// <summary>Kept for the app's owner, logged, and emailed to DELIOS.</summary>
    private static async Task<IResult> AskAsync(AskRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, Notifier notifier,
        IOptions<EmailOptions> email, IClock clock, CancellationToken cancellationToken)
    {
        var what = request.What?.Trim().ToUpperInvariant() ?? "";
        if (!Words.TryGetValue(what, out var words)) return Problems.Invalid("UNKNOWN_REQUEST", "DELIOS does not offer that.");
        var message = string.IsNullOrWhiteSpace(request.Message) ? null : request.Message.Trim();
        if (message is { Length: > 2000 }) return Problems.Invalid("TOO_LONG", "Keep it under 2,000 characters.", new { field = "message" });
        var tenantId = http.User.TenantId();
        var tenant = await db.Tenants.AsNoTracking().SingleAsync(t => t.Id == tenantId, cancellationToken);
        var by = await db.Users.AsNoTracking().SingleAsync(u => u.Id == http.User.UserId(), cancellationToken);
        var ask = new ProductRequest
        {
            TenantId = tenantId, OrganizationName = tenant.Name, What = what, Message = message,
            ByUserId = by.Id, ByName = by.Name, ByEmail = by.Email, At = clock.GetCurrentInstant(),
        };
        db.Add(ask);
        if (email.Value.DeliosAddress is { Length: > 0 } to && to.Contains('@'))
            notifier.Queue(tenantId, null, EmailKinds.Account, to, "DELIOS", $"{tenant.Name} asks for: {words}",
                $"{tenant.Name} asks for {words.ToLowerInvariant()}.\n\nAsked by {by.Name} <{by.Email}>.\n\n{message ?? "No message."}",
                "ProductRequest", ask.Id, replyTo: by.Email);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "PRODUCT_REQUESTED", "ProductRequest", ask.Id, words, message, cancellationToken: cancellationToken);
        return Results.Ok(new Asked(ask.Id, ask.What, ask.Message, ask.ByName, ask.At));
    }
}

/// <summary><c>requests</c> (backend command): every ask of every organization, for the app's owner, newest first.</summary>
public sealed class ListProductRequests(DeliosDbContext db)
{
    public async Task<string> RunAsync(CancellationToken cancellationToken = default)
    {
        var all = await db.Set<ProductRequest>().AsNoTracking().OrderByDescending(r => r.At).ToListAsync(cancellationToken);
        return all.Count == 0 ? "Nobody asked for anything yet."
            : string.Join('\n', all.Select(r => $"{r.At:yyyy-MM-dd HH:mm}  {r.OrganizationName}  {r.What}  {r.ByName} <{r.ByEmail}>: {r.Message ?? "no message"}"));
    }
}
