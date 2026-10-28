using System.Globalization;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;
using PdfSharp.Drawing;
using PdfSharp.Fonts;
using PdfSharp.Pdf;

namespace Delios.Host.Operators;

/// <summary>Who an organization's invoices are made out to: its legal name, address and tax number, kept by its administrators.</summary>
public sealed class BillingDetails
{
    public Guid TenantId { get; set; }
    public required string LegalName { get; set; }
    public string? Address { get; set; }
    public string? Country { get; set; }
    /// <summary>Its tax number where it has one: VAT number, ICE in Morocco…</summary>
    public string? TaxNumber { get; set; }
    /// <summary>Where invoices are sent; none: its administrators.</summary>
    public string? Email { get; set; }
    public string? Reference { get; set; }
    public Instant UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
}

/// <summary>
/// An invoice DELIOS issues to an organization (owner: "cheaper and reliable": paid by bank transfer, CMI or a card
/// later). Numbered by year and never deleted: a mistake is voided with why, and a new one issued. What the buyer and the
/// seller were when it was issued is kept on it as written then.
/// </summary>
public sealed class Invoice
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public required string Number { get; set; }
    public LocalDate IssuedOn { get; set; }
    public LocalDate DueOn { get; set; }
    public LocalDate? PeriodFrom { get; set; }
    public LocalDate? PeriodTo { get; set; }
    public string Currency { get; set; } = "EUR";
    public decimal Subtotal { get; set; }
    /// <summary>Tax rate in percent (20 for Morocco's VAT); 0 when none applies.</summary>
    public decimal TaxRate { get; set; }
    public decimal Tax { get; set; }
    public decimal Total { get; set; }
    /// <summary><see cref="InvoiceStates"/>.</summary>
    public string State { get; set; } = InvoiceStates.Issued;
    public LocalDate? PaidOn { get; set; }
    /// <summary><see cref="PaymentWays"/>.</summary>
    public string? PaidBy { get; set; }
    public string? PaymentReference { get; set; }
    public string? VoidReason { get; set; }
    public required string Buyer { get; set; }
    public required string Seller { get; set; }
    public string? Note { get; set; }
    public required string IssuedBy { get; set; }
    public Instant CreatedAt { get; set; }
    public List<InvoiceLine> Lines { get; set; } = [];
}

public sealed class InvoiceLine
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid InvoiceId { get; set; }
    public int Position { get; set; }
    public required string Description { get; set; }
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal Amount { get; set; }
}

public static class InvoiceStates
{
    public const string Issued = "ISSUED", Paid = "PAID", Void = "VOID";
}

/// <summary>How an invoice was paid (provisional codes, the owner to confirm).</summary>
public static class PaymentWays
{
    public const string Transfer = "TRANSFER", Cmi = "CMI", Paddle = "PADDLE", Other = "OTHER";
    public static readonly string[] All = [Transfer, Cmi, Paddle, Other];
}

/// <summary>DELIOS's own details on every invoice, set in the console (the seller, its bank, its tax numbers).</summary>
public static class SellerKeys
{
    public const string Name = "SELLER_NAME", Address = "SELLER_ADDRESS", TaxNumbers = "SELLER_TAX_NUMBERS", Bank = "SELLER_BANK",
        TaxRate = "INVOICE_TAX_RATE", DueDays = "INVOICE_DUE_DAYS", Mentions = "INVOICE_MENTIONS";
    public static readonly string[] All = [Name, Address, TaxNumbers, Bank, TaxRate, DueDays, Mentions];
}

internal sealed class BillingConfiguration : IEntityTypeConfiguration<BillingDetails>, IEntityTypeConfiguration<Invoice>, IEntityTypeConfiguration<InvoiceLine>
{
    public void Configure(EntityTypeBuilder<BillingDetails> b)
    {
        b.ToTable("billing_details");
        b.HasKey(x => x.TenantId);
        b.Property(x => x.LegalName).HasMaxLength(300);
        b.Property(x => x.Address).HasMaxLength(1000);
        b.Property(x => x.Country).HasMaxLength(100);
        b.Property(x => x.TaxNumber).HasMaxLength(100);
        b.Property(x => x.Email).HasMaxLength(254);
        b.Property(x => x.Reference).HasMaxLength(200);
        b.Property(x => x.UpdatedBy).HasMaxLength(200);
    }

    public void Configure(EntityTypeBuilder<Invoice> b)
    {
        b.ToTable("invoices");
        b.HasIndex(x => x.Number).IsUnique();
        b.HasIndex(x => x.TenantId);
        b.Property(x => x.Number).HasMaxLength(32);
        b.Property(x => x.Currency).HasMaxLength(3);
        b.Property(x => x.Subtotal).HasPrecision(14, 2);
        b.Property(x => x.TaxRate).HasPrecision(5, 2);
        b.Property(x => x.Tax).HasPrecision(14, 2);
        b.Property(x => x.Total).HasPrecision(14, 2);
        b.Property(x => x.State).HasMaxLength(16);
        b.Property(x => x.PaidBy).HasMaxLength(16);
        b.Property(x => x.PaymentReference).HasMaxLength(200);
        b.Property(x => x.VoidReason).HasMaxLength(1000);
        b.Property(x => x.Buyer).HasMaxLength(2000);
        b.Property(x => x.Seller).HasMaxLength(4000);
        b.Property(x => x.Note).HasMaxLength(2000);
        b.Property(x => x.IssuedBy).HasMaxLength(200);
        b.HasMany(x => x.Lines).WithOne().HasForeignKey(x => x.InvoiceId);
    }

    public void Configure(EntityTypeBuilder<InvoiceLine> b)
    {
        b.ToTable("invoice_lines");
        b.Property(x => x.Description).HasMaxLength(500);
        b.Property(x => x.Quantity).HasPrecision(12, 2);
        b.Property(x => x.UnitPrice).HasPrecision(14, 2);
        b.Property(x => x.Amount).HasPrecision(14, 2);
    }
}

/// <summary>
/// Billing: the console issues invoices, records payments and voids with why; an organization's administrators keep
/// who invoices are made out to, read their invoices and download them, and read how to pay. Payment by bank transfer is
/// recorded by hand when it arrives; CMI and Paddle are recorded the same way until they are connected.
/// </summary>
public static class BillingEndpoints
{
    public sealed record LineRequest(string? Description, decimal? Quantity, decimal? UnitPrice);
    public sealed record InvoiceRequest(DateOnly? IssuedOn, DateOnly? PeriodFrom, DateOnly? PeriodTo, string? Currency, decimal? TaxRate,
        LineRequest[]? Lines, string? Note, bool ExtendsPaidUntil = true);
    public sealed record PaidRequest(DateOnly? PaidOn, string? PaidBy, string? Reference);
    public sealed record VoidRequest(string? Why);
    public sealed record DetailsRequest(string? LegalName, string? Address, string? Country, string? TaxNumber, string? Email, string? Reference);
    public sealed record SellerRequest(string? Name, string? Address, string? TaxNumbers, string? Bank, decimal? TaxRate, int? DueDays, string? Mentions);

    public static void MapBillingEndpoints(this IEndpointRouteBuilder app)
    {
        var console = app.MapGroup("/api/console").WithTags("Console").AllowAnonymous().AddEndpointFilter(OperatorAuth.Gate);
        console.MapGet("/invoices", async (DeliosDbContext db, CancellationToken c) =>
        {
            var all = await db.Set<Invoice>().AsNoTracking().OrderByDescending(i => i.Number).Take(500).ToListAsync(c);
            var ids = all.Select(i => i.TenantId).Distinct().ToList();
            var names = await db.Tenants.AsNoTracking().Where(t => ids.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => t.Name, c);
            return Results.Ok(all.Select(i => Row(i, names.GetValueOrDefault(i.TenantId))));
        });
        console.MapGet("/organizations/{id:guid}/billing", async (Guid id, DeliosDbContext db, CancellationToken c) => Results.Ok(new
        {
            details = await db.Set<BillingDetails>().AsNoTracking().SingleOrDefaultAsync(d => d.TenantId == id, c),
            invoices = (await db.Set<Invoice>().AsNoTracking().Include(i => i.Lines).Where(i => i.TenantId == id).OrderByDescending(i => i.Number).ToListAsync(c))
                .Select(i => Row(i, null)),
        }));
        console.MapPost("/organizations/{id:guid}/invoices", IssueAsync);
        console.MapPost("/invoices/{id:guid}/paid", PaidAsync);
        console.MapPost("/invoices/{id:guid}/void", VoidAsync);
        console.MapGet("/invoices/{id:guid}/pdf", async (Guid id, DeliosDbContext db, CancellationToken c) =>
            await PdfAsync(db, await db.Set<Invoice>().AsNoTracking().Include(i => i.Lines).SingleOrDefaultAsync(i => i.Id == id, c), c));
        console.MapGet("/seller", async (DeliosDbContext db, CancellationToken c) => Results.Ok(await SellerAsync(db, c)));
        console.MapPut("/seller", SetSellerAsync);

        var admins = app.MapGroup("/api/organization").WithTags("Organizations")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter(Keepers.Configurers("An administrator answers for the organization's billing."));
        admins.MapGet("/billing", async (HttpContext http, DeliosDbContext db, CancellationToken c) =>
        {
            var tenantId = http.User.TenantId();
            var seller = await SellerAsync(db, c);
            return Results.Ok(new
            {
                details = await db.Set<BillingDetails>().AsNoTracking().SingleOrDefaultAsync(d => d.TenantId == tenantId, c),
                invoices = (await db.Set<Invoice>().AsNoTracking().Where(i => i.TenantId == tenantId).OrderByDescending(i => i.Number).ToListAsync(c))
                    .Select(i => Row(i, null)),
                payTo = new { name = seller.GetValueOrDefault(SellerKeys.Name), bank = seller.GetValueOrDefault(SellerKeys.Bank) },
            });
        });
        admins.MapPut("/billing", SetDetailsAsync);
        admins.MapGet("/invoices/{id:guid}/pdf", async (Guid id, HttpContext http, DeliosDbContext db, CancellationToken c) =>
        {
            var tenantId = http.User.TenantId();
            return await PdfAsync(db, await db.Set<Invoice>().AsNoTracking().Include(i => i.Lines).SingleOrDefaultAsync(i => i.Id == id && i.TenantId == tenantId, c), c);
        });
    }

    private static object Row(Invoice i, string? organization) => new
    {
        i.Id, i.TenantId, organization, i.Number, i.IssuedOn, i.DueOn, i.PeriodFrom, i.PeriodTo, i.Currency, i.Subtotal, i.TaxRate, i.Tax, i.Total,
        i.State, i.PaidOn, i.PaidBy, i.PaymentReference, i.VoidReason, i.Note, i.IssuedBy, i.CreatedAt,
        lines = i.Lines.OrderBy(l => l.Position).Select(l => new { l.Description, l.Quantity, l.UnitPrice, l.Amount }),
    };

    public static async Task<Dictionary<string, string>> SellerAsync(DeliosDbContext db, CancellationToken cancellationToken) =>
        await db.Set<PlatformSetting>().AsNoTracking().Where(p => SellerKeys.All.Contains(p.Key)).ToDictionaryAsync(p => p.Key, p => p.Value, cancellationToken);

    private static async Task<IResult> SetSellerAsync(SellerRequest request, HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        if (request.TaxRate is < 0 or > 100) return Problems.Invalid("TAX_RATE", "A rate from 0 to 100.", new { field = "taxRate" });
        if (request.DueDays is < 0 or > 365) return Problems.Invalid("DUE_DAYS", "From 0 to 365 days.", new { field = "dueDays" });
        var values = new Dictionary<string, string?>
        {
            [SellerKeys.Name] = request.Name, [SellerKeys.Address] = request.Address, [SellerKeys.TaxNumbers] = request.TaxNumbers,
            [SellerKeys.Bank] = request.Bank, [SellerKeys.TaxRate] = request.TaxRate?.ToString(CultureInfo.InvariantCulture),
            [SellerKeys.DueDays] = request.DueDays?.ToString(CultureInfo.InvariantCulture), [SellerKeys.Mentions] = request.Mentions,
        };
        var now = clock.GetCurrentInstant();
        var who = http.Current();
        foreach (var (key, raw) in values)
        {
            var value = raw?.Trim();
            var row = await db.Set<PlatformSetting>().SingleOrDefaultAsync(p => p.Key == key, cancellationToken);
            if (string.IsNullOrWhiteSpace(value)) { if (row is not null) db.Remove(row); continue; }
            if (row is null) db.Add(row = new PlatformSetting { Key = key, Value = "" });
            row.Value = value.Length > 1000 ? value[..1000] : value;
            row.UpdatedAt = now;
            row.UpdatedBy = who.Name;
        }
        db.Add(new OperatorEvent { OperatorId = who.Id, OperatorName = who.Name, Action = "SELLER_SET", Detail = request.Name, At = now });
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> SetDetailsAsync(DetailsRequest request, HttpContext http, DeliosDbContext db, Audit.AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        var name = request.LegalName?.Trim() ?? "";
        if (name.Length is 0 or > 300) return Problems.Invalid("NAME_REQUIRED", "The organization's legal name, as invoices carry it.", new { field = "legalName" });
        var email = request.Email?.Trim();
        if (!string.IsNullOrEmpty(email) && !email.Contains('@')) return Problems.Invalid("EMAIL_INVALID", "An email address.", new { field = "email" });
        var tenantId = http.User.TenantId();
        var row = await db.Set<BillingDetails>().SingleOrDefaultAsync(d => d.TenantId == tenantId, cancellationToken);
        if (row is null) db.Add(row = new BillingDetails { TenantId = tenantId, LegalName = name });
        row.LegalName = name;
        row.Address = Clip(request.Address, 1000);
        row.Country = Clip(request.Country, 100);
        row.TaxNumber = Clip(request.TaxNumber, 100);
        row.Email = Clip(email, 254);
        row.Reference = Clip(request.Reference, 200);
        row.UpdatedAt = clock.GetCurrentInstant();
        row.UpdatedBy = http.User.Identity?.Name;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "BILLING_DETAILS_SET", "BillingDetails", tenantId, name, cancellationToken: cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// Issues an invoice: numbered DLS-&lt;year&gt;-&lt;n&gt;, the buyer and seller written on it as they are now; its
    /// organization's administrators are told, and its billing email sent the news.
    /// </summary>
    private static async Task<IResult> IssueAsync(Guid id, InvoiceRequest request, HttpContext http, DeliosDbContext db, IServiceScopeFactory scopes,
        IClock clock, CancellationToken cancellationToken)
    {
        var tenant = await db.Tenants.AsNoTracking().SingleOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (tenant is null) return Problems.NotFound("NO_SUCH_ORGANIZATION", "No such organization.");
        var lines = (request.Lines ?? []).Where(l => !string.IsNullOrWhiteSpace(l.Description)).ToList();
        if (lines.Count == 0) return Problems.Invalid("LINES_REQUIRED", "At least one line: what is invoiced.", new { field = "lines" });
        if (lines.Any(l => l.Quantity is null or <= 0 || l.UnitPrice is null or < 0))
            return Problems.Invalid("LINE_INVALID", "Each line has a quantity above zero and a price not below zero.", new { field = "lines" });
        var currency = (request.Currency ?? "EUR").Trim().ToUpperInvariant();
        if (currency.Length != 3) return Problems.Invalid("CURRENCY", "A currency's three letters (MAD, EUR, USD).", new { field = "currency" });
        var seller = await SellerAsync(db, cancellationToken);
        var rate = request.TaxRate ?? (decimal.TryParse(seller.GetValueOrDefault(SellerKeys.TaxRate), NumberStyles.Number, CultureInfo.InvariantCulture, out var r) ? r : 0);
        if (rate is < 0 or > 100) return Problems.Invalid("TAX_RATE", "A rate from 0 to 100.", new { field = "taxRate" });
        var details = await db.Set<BillingDetails>().AsNoTracking().SingleOrDefaultAsync(d => d.TenantId == id, cancellationToken);
        var issued = request.IssuedOn is { } on ? LocalDate.FromDateOnly(on) : clock.GetCurrentInstant().InUtc().Date;
        var dueDays = int.TryParse(seller.GetValueOrDefault(SellerKeys.DueDays), out var d) ? d : 30;
        var prefix = $"DLS-{issued.Year}-";
        var last = await db.Set<Invoice>().Where(i => i.Number.StartsWith(prefix)).Select(i => i.Number).ToListAsync(cancellationToken);
        var next = last.Select(n => int.TryParse(n[prefix.Length..], out var x) ? x : 0).DefaultIfEmpty(0).Max() + 1;
        var invoice = new Invoice
        {
            TenantId = id, Number = $"{prefix}{next:D4}", IssuedOn = issued, DueOn = issued.PlusDays(dueDays),
            PeriodFrom = request.PeriodFrom is { } pf ? LocalDate.FromDateOnly(pf) : null, PeriodTo = request.PeriodTo is { } pt ? LocalDate.FromDateOnly(pt) : null,
            Currency = currency, TaxRate = rate, Note = Clip(request.Note, 2000), IssuedBy = http.Current().Name, CreatedAt = clock.GetCurrentInstant(),
            Buyer = details is null ? tenant.Name : string.Join('\n', new[] { details.LegalName, details.Address, details.Country,
                details.TaxNumber is null ? null : $"Tax number: {details.TaxNumber}", details.Reference is null ? null : $"Their reference: {details.Reference}" }
                .Where(x => !string.IsNullOrWhiteSpace(x))),
            Seller = string.Join('\n', new[] { seller.GetValueOrDefault(SellerKeys.Name) ?? "DELIOS", seller.GetValueOrDefault(SellerKeys.Address),
                seller.GetValueOrDefault(SellerKeys.TaxNumbers) }.Where(x => !string.IsNullOrWhiteSpace(x))),
        };
        var position = 0;
        foreach (var l in lines)
        {
            var amount = Math.Round(l.Quantity!.Value * l.UnitPrice!.Value, 2, MidpointRounding.AwayFromZero);
            invoice.Lines.Add(new InvoiceLine { Position = position++, Description = l.Description!.Trim()[..Math.Min(l.Description.Trim().Length, 500)],
                Quantity = l.Quantity.Value, UnitPrice = l.UnitPrice.Value, Amount = amount });
        }
        invoice.Subtotal = invoice.Lines.Sum(l => l.Amount);
        invoice.Tax = Math.Round(invoice.Subtotal * rate / 100, 2, MidpointRounding.AwayFromZero);
        invoice.Total = invoice.Subtotal + invoice.Tax;
        db.Add(invoice);
        db.Add(new OperatorEvent { OperatorId = http.Current().Id, OperatorName = http.Current().Name, Action = "INVOICE_ISSUED", TenantId = id,
            Detail = $"{invoice.Number}: {invoice.Total:0.00} {currency}", At = clock.GetCurrentInstant() });
        await db.SaveChangesAsync(cancellationToken);
        await TellAsync(scopes, id, details?.Email, $"Invoice {invoice.Number} from DELIOS",
            $"DELIOS issued invoice {invoice.Number}: {invoice.Total.ToString("0.00", CultureInfo.InvariantCulture)} {currency}, due {invoice.DueOn:yyyy-MM-dd}. "
            + "Download it, and read how to pay, in the organization's Settings → Contract & plan.", cancellationToken);
        return Results.Ok(new { invoice.Id, invoice.Number });
    }

    /// <summary>A payment arrived (a transfer seen on the bank account, CMI, Paddle…): recorded, and the period paid moves on.</summary>
    private static async Task<IResult> PaidAsync(Guid id, PaidRequest request, HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        var invoice = await db.Set<Invoice>().SingleOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (invoice is null) return Problems.NotFound("NO_SUCH_INVOICE", "No such invoice.");
        if (invoice.State != InvoiceStates.Issued) return Problems.Conflict("NOT_OPEN", "Only an invoice waiting for payment is marked paid.");
        var way = request.PaidBy?.Trim().ToUpperInvariant() ?? "";
        if (!PaymentWays.All.Contains(way)) return Problems.Invalid("WAY_UNKNOWN", "Say how it was paid.", new { field = "paidBy" });
        var now = clock.GetCurrentInstant();
        invoice.State = InvoiceStates.Paid;
        invoice.PaidOn = request.PaidOn is { } on ? LocalDate.FromDateOnly(on) : now.InUtc().Date;
        invoice.PaidBy = way;
        invoice.PaymentReference = Clip(request.Reference, 200);
        // The period it paid for is paid: "paid until" moves to its end when that is later.
        if (invoice.PeriodTo is { } to)
        {
            var until = to.PlusDays(1).AtStartOfDayInZone(DateTimeZone.Utc).ToInstant() - Duration.FromSeconds(1);
            var sub = await db.Set<Subscription>().SingleOrDefaultAsync(s => s.TenantId == invoice.TenantId, cancellationToken);
            if (sub is null) db.Add(sub = new Subscription { TenantId = invoice.TenantId });
            if (sub.PaidUntil is null || sub.PaidUntil < until) sub.PaidUntil = until;
            if (sub.State is SubscriptionStates.Trial or SubscriptionStates.ReadOnly) sub.State = SubscriptionStates.Active;
            sub.UpdatedAt = now;
            sub.UpdatedBy = http.Current().Name;
        }
        db.Add(new OperatorEvent { OperatorId = http.Current().Id, OperatorName = http.Current().Name, Action = "INVOICE_PAID", TenantId = invoice.TenantId,
            Detail = $"{invoice.Number} by {way}{(invoice.PaymentReference is null ? "" : $", {invoice.PaymentReference}")}", At = now });
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> VoidAsync(Guid id, VoidRequest request, HttpContext http, DeliosDbContext db, IClock clock, CancellationToken cancellationToken)
    {
        var why = request.Why?.Trim() ?? "";
        if (why.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why it is voided.", new { field = "why" });
        var invoice = await db.Set<Invoice>().SingleOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (invoice is null) return Problems.NotFound("NO_SUCH_INVOICE", "No such invoice.");
        if (invoice.State == InvoiceStates.Void) return Results.NoContent();
        invoice.State = InvoiceStates.Void;
        invoice.VoidReason = Clip(why, 1000);
        db.Add(new OperatorEvent { OperatorId = http.Current().Id, OperatorName = http.Current().Name, Action = "INVOICE_VOIDED", TenantId = invoice.TenantId,
            Detail = $"{invoice.Number}: {why}", At = clock.GetCurrentInstant() });
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task TellAsync(IServiceScopeFactory scopes, Guid tenantId, string? billingEmail, string title, string body, CancellationToken cancellationToken) =>
        await TenantScope.RunAsync(scopes, tenantId, async (services, there) =>
        {
            var admins = await there.Users.AsNoTracking().Where(u => u.TenantId == tenantId && u.IsAdmin && u.Active && !u.IsSupport && u.HomeTenantId == null)
                .Select(u => u.Id).ToListAsync(cancellationToken);
            var notifier = services.GetRequiredService<Notifications.Notifier>();
            await notifier.NotifyAsync(tenantId, null, admins, "PLATFORM", title, body, "/organization/settings/contract", cancellationToken);
            if (!string.IsNullOrWhiteSpace(billingEmail))
                notifier.Queue(tenantId, null, Notifications.EmailKinds.Account, billingEmail, billingEmail, title, body, "Invoice", null);
        }, cancellationToken);

    private static async Task<IResult> PdfAsync(DeliosDbContext db, Invoice? invoice, CancellationToken cancellationToken)
    {
        if (invoice is null) return Problems.NotFound("NO_SUCH_INVOICE", "No such invoice.");
        var seller = await SellerAsync(db, cancellationToken);
        return Results.File(Render(invoice, seller), "application/pdf", $"{invoice.Number}.pdf");
    }

    static BillingEndpoints() => GlobalFontSettings.FontResolver ??= new EmbeddedFonts();

    /// <summary>The invoice as a PDF: seller and buyer, lines, totals, how to pay, the mentions the law asks.</summary>
    public static byte[] Render(Invoice invoice, IReadOnlyDictionary<string, string> seller)
    {
        using var pdf = new PdfDocument();
        pdf.Info.Title = $"Invoice {invoice.Number}";
        var page = pdf.AddPage();
        using var gfx = XGraphics.FromPdfPage(page);
        var title = new XFont(EmbeddedFonts.Family, 18, XFontStyleEx.Bold);
        var bold = new XFont(EmbeddedFonts.Family, 9, XFontStyleEx.Bold);
        var text = new XFont(EmbeddedFonts.Family, 9, XFontStyleEx.Regular);
        var small = new XFont(EmbeddedFonts.Family, 7, XFontStyleEx.Regular);
        var ink = new XSolidBrush(XColor.FromArgb(16, 42, 67));
        var grey = new XSolidBrush(XColor.FromArgb(100, 116, 139));
        var money = (decimal v) => $"{v.ToString("N2", CultureInfo.InvariantCulture)} {invoice.Currency}";
        double left = 50, right = page.Width.Point - 50, y = 60;
        gfx.DrawString(invoice.State == InvoiceStates.Void ? "INVOICE (VOID)" : "INVOICE", title, ink, left, y);
        gfx.DrawString(invoice.Number, bold, ink, new XRect(left, y - 14, right - left, 14), XStringFormats.TopRight);
        gfx.DrawString($"Issued {invoice.IssuedOn:yyyy-MM-dd} · due {invoice.DueOn:yyyy-MM-dd}", text, grey, new XRect(left, y, right - left, 12), XStringFormats.TopRight);
        y += 30;
        double Block(string head, string body, double x, double top)
        {
            gfx.DrawString(head, bold, grey, x, top);
            var at = top + 13;
            foreach (var line in body.Split('\n')) { gfx.DrawString(line, text, XBrushes.Black, x, at); at += 12; }
            return at;
        }
        var end = Math.Max(Block("FROM", invoice.Seller, left, y), Block("BILLED TO", invoice.Buyer, (left + right) / 2, y));
        y = end + 16;
        if (invoice.PeriodFrom is not null || invoice.PeriodTo is not null)
        {
            gfx.DrawString($"Period: {invoice.PeriodFrom:yyyy-MM-dd} → {invoice.PeriodTo:yyyy-MM-dd}", text, XBrushes.Black, left, y);
            y += 18;
        }
        gfx.DrawRectangle(new XSolidBrush(XColor.FromArgb(241, 245, 249)), left, y - 10, right - left, 16);
        gfx.DrawString("Description", bold, ink, left + 4, y + 2);
        gfx.DrawString("Qty", bold, ink, new XRect(left, y - 8, right - left - 190, 12), XStringFormats.TopRight);
        gfx.DrawString("Unit price", bold, ink, new XRect(left, y - 8, right - left - 95, 12), XStringFormats.TopRight);
        gfx.DrawString("Amount", bold, ink, new XRect(left, y - 8, right - left - 4, 12), XStringFormats.TopRight);
        y += 20;
        foreach (var l in invoice.Lines.OrderBy(l => l.Position))
        {
            gfx.DrawString(l.Description.Length > 70 ? l.Description[..70] + "…" : l.Description, text, XBrushes.Black, left + 4, y);
            gfx.DrawString(l.Quantity.ToString("0.##", CultureInfo.InvariantCulture), text, XBrushes.Black, new XRect(left, y - 9, right - left - 190, 12), XStringFormats.TopRight);
            gfx.DrawString(money(l.UnitPrice), text, XBrushes.Black, new XRect(left, y - 9, right - left - 95, 12), XStringFormats.TopRight);
            gfx.DrawString(money(l.Amount), text, XBrushes.Black, new XRect(left, y - 9, right - left - 4, 12), XStringFormats.TopRight);
            y += 15;
        }
        y += 6;
        gfx.DrawLine(new XPen(XColor.FromArgb(203, 213, 225), 0.6), (left + right) / 2, y, right, y);
        y += 14;
        void Total(string label, string value, XFont font)
        {
            gfx.DrawString(label, font, XBrushes.Black, (left + right) / 2, y);
            gfx.DrawString(value, font, XBrushes.Black, new XRect(left, y - 9, right - left - 4, 12), XStringFormats.TopRight);
            y += 15;
        }
        Total("Subtotal", money(invoice.Subtotal), text);
        Total(invoice.TaxRate == 0 ? "Tax" : $"Tax {invoice.TaxRate.ToString("0.##", CultureInfo.InvariantCulture)}%", money(invoice.Tax), text);
        Total("Total", money(invoice.Total), bold);
        y += 14;
        if (invoice.State == InvoiceStates.Paid)
        {
            gfx.DrawString($"Paid on {invoice.PaidOn:yyyy-MM-dd}{(invoice.PaymentReference is null ? "" : $" · {invoice.PaymentReference}")}. Thank you.", bold,
                new XSolidBrush(XColor.FromArgb(4, 120, 87)), left, y);
            y += 18;
        }
        else if (invoice.State == InvoiceStates.Void)
        {
            gfx.DrawString($"Voided: {invoice.VoidReason}", bold, new XSolidBrush(XColor.FromArgb(185, 28, 28)), left, y);
            y += 18;
        }
        if (seller.GetValueOrDefault(SellerKeys.Bank) is { Length: > 0 } bank && invoice.State == InvoiceStates.Issued)
        {
            y = Block("HOW TO PAY", $"By bank transfer, quoting {invoice.Number}:\n{bank}", left, y) + 6;
        }
        if (invoice.Note is { Length: > 0 } note) y = Block("NOTE", note, left, y) + 6;
        var mentions = seller.GetValueOrDefault(SellerKeys.Mentions);
        var footer = string.IsNullOrWhiteSpace(mentions) ? "" : mentions.Replace('\n', ' ');
        if (footer.Length > 0)
            gfx.DrawString(footer.Length > 160 ? footer[..160] + "…" : footer, small, grey, new XRect(left, page.Height.Point - 60, right - left, 12), XStringFormats.TopLeft);
        using var output = new MemoryStream();
        pdf.Save(output);
        return output.ToArray();
    }

    private static string? Clip(string? text, int max) =>
        string.IsNullOrWhiteSpace(text) ? null : text.Trim() is var t && t.Length > max ? t[..max] : text.Trim();
}
