using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Organizations;

/// <summary>
/// A value that belongs to one thing across the whole of DELIOS, every organization's data together: a project's code
/// or name, an organization's code or name, a contract number. Kept outside any organization's data (no row-level
/// security), as the reply addresses are. A value once used stays with what used it, even after it was changed, so
/// the records that carry the old one keep meaning it and nobody else is ever given it.
/// </summary>
public sealed class ReservedValue
{
    /// <summary>What it is: <see cref="ReservedKinds"/>.</summary>
    public required string Kind { get; set; }
    /// <summary>The value as compared: trimmed, spaces collapsed, upper case.</summary>
    public required string Value { get; set; }
    /// <summary>As it was written.</summary>
    public required string Shown { get; set; }
    /// <summary>What holds it: the project, the organization (<see cref="OrganizationIdentity"/>) or the project's party.</summary>
    public Guid HolderId { get; set; }
    /// <summary>The organization whose data first used it.</summary>
    public Guid TenantId { get; set; }
    public Instant ReservedAt { get; set; }
}

/// <summary>The kinds of values unique across DELIOS.</summary>
public static class ReservedKinds
{
    public const string ProjectCode = "PROJECT_CODE";
    public const string ProjectName = "PROJECT_NAME";
    public const string OrganizationCode = "ORG_CODE";
    public const string OrganizationName = "ORG_NAME";
    public const string Contract = "CONTRACT";
    /// <summary>Country, kind and number of an organization's identifier: <c>MA|COMPANY|12345</c>.</summary>
    public const string OrganizationIdentifier = "ORG_IDENT";
}

/// <summary>
/// The kinds of identifier an organization is known by, beside its name, best first: its company registration (the
/// country's register of companies), else its tax number, else its number on a professional register (an order of
/// architects or engineers), else a public body's own. Always with its country: the same number exists in two.
/// </summary>
public static class IdentifierKinds
{
    public const string Company = "COMPANY", Tax = "TAX", Professional = "PROFESSIONAL", Public = "PUBLIC";
    public static readonly string[] All = [Company, Tax, Professional, Public];
}

/// <summary>
/// One organization as the whole of DELIOS knows it: one code and one name, the same in every organization's list that
/// holds it, so its history reads under one name everywhere. Each may be changed once, for a mistake; the old one stays
/// reserved to it. An organization on DELIOS (<see cref="TenantId"/>) is the only one to change its own.
/// </summary>
public sealed class OrganizationIdentity
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Code { get; set; }
    public required string Name { get; set; }
    /// <summary>The organization on DELIOS it is, when it is one (its own party); null for one known only in others' lists.</summary>
    public Guid? TenantId { get; set; }
    public Instant CreatedAt { get; set; }
    public string? PreviousCode { get; set; }
    public Instant? CodeChangedAt { get; set; }
    public string? CodeChangedByName { get; set; }
    public string? PreviousName { get; set; }
    public Instant? NameChangedAt { get; set; }
    public string? NameChangedByName { get; set; }
    /// <summary>The organization whose list first held it: the side that answers for it while it is not on DELIOS itself.</summary>
    public Guid? CreatedByTenantId { get; set; }
    /// <summary>Its identifier (<see cref="IdentifierKinds"/>): country (ISO 3166, two letters), kind and number; unique across DELIOS.</summary>
    public string? Country { get; set; }
    public string? IdentifierKind { get; set; }
    public string? IdentifierNumber { get; set; }
    /// <summary>Why it has none, when it has none (a company being set up, someone working alone without a number…).</summary>
    public string? NoIdentifierReason { get; set; }
    public string? PreviousIdentifier { get; set; }
    public Instant? IdentifierChangedAt { get; set; }
    public string? IdentifierChangedByName { get; set; }
    /// <summary>The domain of its email addresses (acme.com): said by whoever adds it; proven by an organization on DELIOS for itself.</summary>
    public string? Domain { get; set; }
    public Instant? DomainConfirmedAt { get; set; }
    /// <summary>Folded into another (a duplicate, merged or claimed): its code and name stay reserved and point there.</summary>
    public Guid? MergedIntoId { get; set; }
    public Instant? MergedAt { get; set; }

    /// <summary>Who answers for it: the organization it is, when it is on DELIOS, else the one that first listed it.</summary>
    public Guid? Side => TenantId ?? CreatedByTenantId;

    /// <summary>Its identifier in words: "MA · company registration 12345".</summary>
    public string? IdentifierShown => IdentifierNumber is null ? null : $"{Country} · {IdentifierKind?.ToLowerInvariant()} {IdentifierNumber}";
}

/// <summary>
/// Two organizations found to be one (a duplicate): asked by one side with why, agreed by every side that answers for
/// them, then carried out by the app's owner (<c>merge-organizations</c>). Nothing is deleted: the merged one's code and
/// name stay reserved and point to the one kept. Kept outside any organization's data, as the register is.
/// </summary>
public sealed class OrganizationMerge
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid KeepId { get; set; }
    public Guid MergeId { get; set; }
    public Guid RequestedByTenantId { get; set; }
    public required string RequestedByName { get; set; }
    public required string Why { get; set; }
    public Instant RequestedAt { get; set; }
    /// <summary>The sides that agreed (the asking one, when it answers for either).</summary>
    public Guid[] AgreedTenantIds { get; set; } = [];
    public string State { get; set; } = MergeStates.Asked;
    public string? RefusedByName { get; set; }
    public string? RefusedWhy { get; set; }
    public Instant? AnsweredAt { get; set; }
    public Instant? DoneAt { get; set; }
}

public static class MergeStates
{
    public const string Asked = "ASKED", Agreed = "AGREED", Refused = "REFUSED", Done = "DONE";
}

/// <summary>Which organization's list holds an organization, as which of its parties: where a change is carried to.</summary>
public sealed class OrganizationHolder
{
    public Guid OrganizationId { get; set; }
    public Guid TenantId { get; set; }
    public Guid PartyId { get; set; }
}

internal sealed class RegistryConfiguration :
    IEntityTypeConfiguration<ReservedValue>, IEntityTypeConfiguration<OrganizationIdentity>, IEntityTypeConfiguration<OrganizationHolder>,
    IEntityTypeConfiguration<OrganizationMerge>
{
    public void Configure(EntityTypeBuilder<OrganizationMerge> b)
    {
        b.Property(x => x.RequestedByName).HasMaxLength(200);
        b.Property(x => x.Why).HasMaxLength(2000);
        b.Property(x => x.State).HasMaxLength(16);
        b.Property(x => x.RefusedByName).HasMaxLength(200);
        b.Property(x => x.RefusedWhy).HasMaxLength(2000);
    }

    public void Configure(EntityTypeBuilder<ReservedValue> b)
    {
        b.HasKey(x => new { x.Kind, x.Value });
        b.Property(x => x.Kind).HasMaxLength(16);
        b.Property(x => x.Value).HasMaxLength(200);
        b.Property(x => x.Shown).HasMaxLength(200);
        b.HasIndex(x => x.HolderId);
    }

    public void Configure(EntityTypeBuilder<OrganizationIdentity> b)
    {
        b.HasIndex(x => x.Code).IsUnique();
        b.Property(x => x.Code).HasMaxLength(32);
        b.Property(x => x.Name).HasMaxLength(200);
        b.Property(x => x.PreviousCode).HasMaxLength(32);
        b.Property(x => x.PreviousName).HasMaxLength(200);
        b.Property(x => x.CodeChangedByName).HasMaxLength(200);
        b.Property(x => x.NameChangedByName).HasMaxLength(200);
        b.Property(x => x.Country).HasMaxLength(2);
        b.Property(x => x.IdentifierKind).HasMaxLength(16);
        b.Property(x => x.IdentifierNumber).HasMaxLength(64);
        b.Property(x => x.NoIdentifierReason).HasMaxLength(2000);
        b.Property(x => x.PreviousIdentifier).HasMaxLength(100);
        b.Property(x => x.IdentifierChangedByName).HasMaxLength(200);
        b.Property(x => x.Domain).HasMaxLength(253);
        b.Ignore(x => x.Side);
        b.Ignore(x => x.IdentifierShown);
        b.HasIndex(x => x.Domain);
    }

    public void Configure(EntityTypeBuilder<OrganizationHolder> b)
    {
        b.HasKey(x => new { x.OrganizationId, x.TenantId, x.PartyId });
    }
}

/// <summary>
/// The rules of what is unique across DELIOS: a project's code and name, an organization's code and name (one of each,
/// the same everywhere), a contract number. Every place that gives or changes one goes through here.
/// </summary>
public static class Registry
{
    /// <summary>How values are compared: trimmed, inner spaces collapsed, upper case.</summary>
    public static string Key(string value) => string.Join(' ', value.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).ToUpperInvariant();

    /// <summary>Who holds this value, if anyone (looking at what is waiting to be saved too).</summary>
    public static async Task<ReservedValue?> HeldAsync(DeliosDbContext db, string kind, string value, CancellationToken cancellationToken)
    {
        var key = Key(value);
        return db.ReservedValues.Local.FirstOrDefault(r => r.Kind == kind && r.Value == key)
            ?? await db.ReservedValues.SingleOrDefaultAsync(r => r.Kind == kind && r.Value == key, cancellationToken);
    }

    /// <summary>Whether the value is free, or already this holder's.</summary>
    public static async Task<bool> FreeForAsync(DeliosDbContext db, string kind, string value, Guid holderId, CancellationToken cancellationToken) =>
        await HeldAsync(db, kind, value, cancellationToken) is not { } held || held.HolderId == holderId;

    /// <summary>Gives the value to its holder for good (nothing when it already is). False: someone else holds it.</summary>
    public static async Task<bool> ReserveAsync(DeliosDbContext db, string kind, string value, Guid holderId, Guid tenantId,
        CancellationToken cancellationToken)
    {
        var held = await HeldAsync(db, kind, value, cancellationToken);
        if (held is not null) return held.HolderId == holderId;
        db.ReservedValues.Add(new ReservedValue
        {
            Kind = kind, Value = Key(value), Shown = value.Trim(), HolderId = holderId, TenantId = tenantId,
            ReservedAt = SystemClock.Instance.GetCurrentInstant(),
        });
        return true;
    }

    /// <summary>
    /// The organization a code and a name stand for. Both new: a new organization. Both the current code and name of one
    /// already known: that one (another organization adds it to its list). Anything else is refused: an organization
    /// has one code and one name everywhere.
    /// </summary>
    public static async Task<(OrganizationIdentity? Identity, IResult? Problem)> OrganizationForAsync(
        DeliosDbContext db, string code, string name, Guid tenantId, Guid? ownTenant, CancellationToken cancellationToken)
    {
        var byCode = await HeldAsync(db, ReservedKinds.OrganizationCode, code, cancellationToken);
        var byName = await HeldAsync(db, ReservedKinds.OrganizationName, name, cancellationToken);
        if (byCode is null && byName is null)
        {
            var identity = new OrganizationIdentity
            {
                Code = code, Name = name.Trim(), TenantId = ownTenant, CreatedByTenantId = tenantId, CreatedAt = SystemClock.Instance.GetCurrentInstant(),
            };
            db.OrganizationIdentities.Add(identity);
            await ReserveAsync(db, ReservedKinds.OrganizationCode, code, identity.Id, tenantId, cancellationToken);
            await ReserveAsync(db, ReservedKinds.OrganizationName, name, identity.Id, tenantId, cancellationToken);
            return (identity, null);
        }
        var holder = byCode?.HolderId ?? byName!.HolderId;
        var known = await IdentityAsync(db, holder, cancellationToken);
        if (known is null) return (null, Problems.Conflict("ORGANIZATION_TAKEN", "That code or name is already taken on DELIOS."));
        if (byCode is not null && byName is not null && byCode.HolderId == byName.HolderId
            && Key(known.Code) == Key(code) && Key(known.Name) == Key(name))
            return (known, null);
        if (byCode is not null && byCode.HolderId == holder && Key(known.Code) != Key(code))
            return (null, Problems.Conflict("ORGANIZATION_RECODED", $"{code} was {known.Name}'s code: it is {known.Code} now.", new { field = "code" }));
        if (byName is not null && byName.HolderId == holder && Key(known.Name) != Key(name))
            return (null, Problems.Conflict("ORGANIZATION_RENAMED", $"{name} is now called {known.Name} ({known.Code}).", new { field = "name" }));
        return byCode is not null
            ? (null, Problems.Conflict("ORGANIZATION_CODE_TAKEN",
                $"{known.Code} is {known.Name}'s code on DELIOS. An organization has one code and one name everywhere: add it as {known.Code} — {known.Name}, or choose another code.",
                new { field = "code" }))
            : (null, Problems.Conflict("ORGANIZATION_NAME_TAKEN",
                $"{known.Name} is already on DELIOS as {known.Code}. An organization has one code and one name everywhere: add it as {known.Code} — {known.Name}.",
                new { field = "code" }));
    }

    /// <summary>The organization by its id; one merged into another reads as the one kept.</summary>
    public static async Task<OrganizationIdentity?> IdentityAsync(DeliosDbContext db, Guid id, CancellationToken cancellationToken)
    {
        for (var hops = 0; hops < 8; hops++)
        {
            var found = db.OrganizationIdentities.Local.FirstOrDefault(o => o.Id == id) ?? await db.OrganizationIdentities.FindAsync([id], cancellationToken);
            if (found?.MergedIntoId is not { } into) return found;
            id = into;
        }
        return null;
    }

    /// <summary>Notes that this organization's list holds the organization, as this party.</summary>
    public static async Task HoldAsync(DeliosDbContext db, OrganizationIdentity identity, Party party, CancellationToken cancellationToken)
    {
        party.OrganizationId = identity.Id;
        var held = db.OrganizationHolders.Local.Any(h => h.OrganizationId == identity.Id && h.PartyId == party.Id)
            || await db.OrganizationHolders.AnyAsync(h => h.OrganizationId == identity.Id && h.PartyId == party.Id, cancellationToken);
        if (!held) db.OrganizationHolders.Add(new OrganizationHolder { OrganizationId = identity.Id, TenantId = party.TenantId, PartyId = party.Id });
    }

    /// <summary>
    /// Changes an organization's code or name, once each, for every list that holds it. The old one stays reserved to
    /// it. An organization on DELIOS changes only its own. Returns the other organizations whose lists hold it, to carry
    /// the change to (<see cref="CarryAsync"/>).
    /// </summary>
    public static async Task<(IReadOnlyList<OrganizationHolder> Elsewhere, IResult? Problem)> ChangeAsync(DeliosDbContext db, OrganizationIdentity identity,
        string? code, string? name, Guid tenantId, string actorName, List<string> changes, CancellationToken cancellationToken)
    {
        var now = SystemClock.Instance.GetCurrentInstant();
        var codeChanges = code is not null && Key(code) != Key(identity.Code);
        var nameChanges = name is not null && name.Trim() != identity.Name;
        if (!codeChanges && !nameChanges) return ([], null);
        if (identity.TenantId is { } own && own != tenantId)
            return ([], Problems.Forbidden("THEIR_OWN", $"{identity.Name} is on DELIOS: only {identity.Name} changes its own code and name."));
        if (codeChanges)
        {
            if (identity.CodeChangedAt is not null)
                return ([], Problems.Conflict("CHANGED_ONCE",
                    $"{identity.Name}'s code was already changed once ({identity.PreviousCode} → {identity.Code}, by {identity.CodeChangedByName}): it is fixed now.",
                    new { field = "code" }));
            if (!await ReserveAsync(db, ReservedKinds.OrganizationCode, code!, identity.Id, tenantId, cancellationToken))
                return ([], Problems.Conflict("ORGANIZATION_CODE_TAKEN", $"{code} is already another organization's code on DELIOS, or was.", new { field = "code" }));
            changes.Add($"code {identity.Code} → {Key(code!)}; numbers already given keep {identity.Code}");
            identity.PreviousCode = identity.Code;
            identity.Code = Key(code!);
            identity.CodeChangedAt = now;
            identity.CodeChangedByName = actorName;
        }
        if (nameChanges)
        {
            if (identity.NameChangedAt is not null)
                return ([], Problems.Conflict("CHANGED_ONCE",
                    $"{identity.Name}'s name was already changed once (was {identity.PreviousName}, by {identity.NameChangedByName}): it is fixed now.",
                    new { field = "name" }));
            if (!await ReserveAsync(db, ReservedKinds.OrganizationName, name!, identity.Id, tenantId, cancellationToken))
                return ([], Problems.Conflict("ORGANIZATION_NAME_TAKEN", $"{name!.Trim()} is already another organization on DELIOS, or was.", new { field = "name" }));
            changes.Add($"name {identity.Name} → {name!.Trim()}");
            identity.PreviousName = identity.Name;
            identity.Name = name!.Trim();
            identity.NameChangedAt = now;
            identity.NameChangedByName = actorName;
        }
        var elsewhere = await db.OrganizationHolders.AsNoTracking().Where(h => h.OrganizationId == identity.Id && h.TenantId != tenantId)
            .ToListAsync(cancellationToken);
        return (elsewhere, null);
    }

    /// <summary>Carries an organization's code and name into the other organizations' lists that hold it.</summary>
    public static async Task CarryAsync(IServiceScopeFactory scopes, OrganizationIdentity identity, IEnumerable<OrganizationHolder> elsewhere,
        CancellationToken cancellationToken)
    {
        foreach (var holder in elsewhere)
        {
            await TenantScope.RunAsync(scopes, holder.TenantId, async (_, there) =>
            {
                await there.Parties.Where(p => p.Id == holder.PartyId)
                    .ExecuteUpdateAsync(p => p.SetProperty(x => x.Code, identity.Code).SetProperty(x => x.Name, identity.Name), cancellationToken);
            }, cancellationToken);
        }
    }

    /// <summary>A code no organization on DELIOS has had yet, from a name or a code wanted.</summary>
    public static async Task<string> FreeOrganizationCodeAsync(DeliosDbContext db, string wanted, CancellationToken cancellationToken)
    {
        var start = new string(Key(wanted).Where(c => char.IsAsciiLetterOrDigit(c) || c == '-').ToArray()).Trim('-');
        if (start.Length == 0) start = "ORG";
        start = start[..Math.Min(start.Length, 12)];
        var code = start;
        for (var n = 2; await HeldAsync(db, ReservedKinds.OrganizationCode, code, cancellationToken) is not null; n++) code = $"{start}-{n}";
        return code;
    }

    // ── Identifiers, look-alikes, claims and merges ─────────────────────────────

    /// <summary>An identifier as compared: country, kind and the number without spaces, dots, dashes or slashes.</summary>
    public static string IdentifierValue(string country, string kind, string number) =>
        $"{country.Trim().ToUpperInvariant()}|{kind.Trim().ToUpperInvariant()}|{NumberKey(number)}";

    public static string NumberKey(string number) =>
        new string(number.ToUpperInvariant().Where(char.IsAsciiLetterOrDigit).ToArray());

    /// <summary>Words a company's name carries for its legal form, left out when names are compared.</summary>
    private static readonly HashSet<string> LegalForms =
    [
        "LTD", "LIMITED", "LLC", "LLP", "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "PLC", "SA", "SAS", "SASU", "SARL",
        "SARLAU", "AU", "EURL", "SNC", "SPA", "SRL", "GMBH", "AG", "KG", "BV", "NV", "OY", "AB", "AS", "APS", "PTY", "PVT", "GROUP", "GROUPE",
        "HOLDING", "THE", "ET", "AND", "CIE",
    ];

    /// <summary>A name as two look-alikes share it: no accents, punctuation, spaces or legal form ("Acme-Pumps SA" → "ACMEPUMPS").</summary>
    public static string NameKey(string name)
    {
        var plain = new string(name.Normalize(System.Text.NormalizationForm.FormD)
            .Where(c => System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) != System.Globalization.UnicodeCategory.NonSpacingMark)
            .Select(c => char.IsLetterOrDigit(c) ? char.ToUpperInvariant(c) : ' ').ToArray());
        var words = plain.Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => !LegalForms.Contains(w)).ToArray();
        return words.Length == 0 ? plain.Replace(" ", "") : string.Concat(words);
    }

    /// <summary>A domain as written by someone: "documents@acme.com", "www.acme.com" or "acme.com" → "acme.com".</summary>
    public static string? DomainOf(string? value)
    {
        var v = value?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(v)) return null;
        if (v.Contains('@')) v = v[(v.LastIndexOf('@') + 1)..];
        if (v.StartsWith("www.")) v = v[4..];
        v = v.Trim('.', '/');
        return v.Contains('.') && v.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-') ? v : null;
    }

    /// <summary>Mail providers anyone has an address with: never an organization's own domain.</summary>
    public static readonly HashSet<string> PublicMail =
    [
        "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.fr", "live.com", "live.fr", "msn.com", "yahoo.com", "yahoo.fr",
        "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "gmx.net", "mail.com", "mail.ru", "yandex.com",
        "yandex.ru", "zoho.com", "orange.fr", "free.fr", "laposte.net", "menara.ma", "web.de", "qq.com", "163.com",
    ];

    /// <summary>One organization already on DELIOS that looks like the one being added, and why.</summary>
    public sealed record Lookalike(Guid Id, string Code, string Name, string? Country, bool OnDelios, string Why);

    /// <summary>
    /// The organizations that look like the one about to be created: the same identifier, the same email domain, or a
    /// near-identical name. Merged ones are left out.
    /// </summary>
    public static async Task<IReadOnlyList<Lookalike>> LookalikesAsync(DeliosDbContext db, string name, string? identifier, string? domain,
        CancellationToken cancellationToken)
    {
        var key = NameKey(name);
        var all = await db.OrganizationIdentities.AsNoTracking().Where(o => o.MergedIntoId == null).ToListAsync(cancellationToken);
        var found = new List<Lookalike>();
        foreach (var o in all)
        {
            string? why = null;
            if (identifier is not null && o.IdentifierNumber is not null && IdentifierValue(o.Country ?? "", o.IdentifierKind ?? "", o.IdentifierNumber) == identifier)
                why = $"the same identifier ({o.IdentifierShown})";
            else if (domain is not null && o.Domain == domain) why = $"the same email domain ({domain})";
            else if (key.Length >= 3 && NameKey(o.Name) == key) why = "a name that reads the same";
            if (why is not null) found.Add(new Lookalike(o.Id, o.Code, o.Name, o.Country, o.TenantId is not null, why));
        }
        return found;
    }

    /// <summary>
    /// Gives an organization its identifier, or changes it once (a mistake put right). Unique across DELIOS: one that
    /// another holds is refused. "None" is said with why. An organization on DELIOS alone sets its own.
    /// </summary>
    public static async Task<IResult?> SetIdentifierAsync(DeliosDbContext db, OrganizationIdentity identity, string? country, string? kind,
        string? number, string? noReason, Guid tenantId, string actorName, List<string> changes, CancellationToken cancellationToken)
    {
        country = country?.Trim().ToUpperInvariant();
        kind = kind?.Trim().ToUpperInvariant();
        number = number?.Trim();
        if (string.IsNullOrEmpty(number))
        {
            if (string.IsNullOrWhiteSpace(noReason) || identity.IdentifierNumber is not null) return null;
            if (identity.NoIdentifierReason != noReason.Trim()) { identity.NoIdentifierReason = noReason.Trim(); changes.Add($"no identifier: {noReason.Trim()}"); }
            return null;
        }
        if (country is null || country.Length != 2 || !country.All(char.IsAsciiLetterUpper))
            return Problems.Invalid("COUNTRY_REQUIRED", "Choose the country the identifier was given in.", new { field = "country" });
        if (kind is null || !IdentifierKinds.All.Contains(kind))
            return Problems.Invalid("IDENTIFIER_KIND", "Say what the number is: company registration, tax number, professional register or public body.", new { field = "identifierKind" });
        if (NumberKey(number).Length < 2) return Problems.Invalid("IDENTIFIER_INVALID", "That is not a number anyone gives.", new { field = "identifierNumber" });
        var value = IdentifierValue(country, kind, number);
        var current = identity.IdentifierNumber is null ? null : IdentifierValue(identity.Country ?? "", identity.IdentifierKind ?? "", identity.IdentifierNumber);
        if (value == current) return null;
        if (identity.TenantId is { } own && own != tenantId)
            return Problems.Forbidden("THEIR_OWN", $"{identity.Name} is on DELIOS: only {identity.Name} gives its own identifier.");
        if (current is not null && identity.IdentifierChangedAt is not null)
            return Problems.Conflict("CHANGED_ONCE",
                $"{identity.Name}'s identifier was already changed once (was {identity.PreviousIdentifier}, by {identity.IdentifierChangedByName}): it is fixed now.",
                new { field = "identifierNumber" });
        if (await HeldAsync(db, ReservedKinds.OrganizationIdentifier, value, cancellationToken) is { } held && held.HolderId != identity.Id)
        {
            var other = await IdentityAsync(db, held.HolderId, cancellationToken);
            return Problems.Conflict("IDENTIFIER_TAKEN",
                $"{country} {kind.ToLowerInvariant()} {number} is {other?.Name ?? "another organization"}'s ({other?.Code}) on DELIOS. If it is the same company, add that one; if it was entered twice, ask for the two to be merged.",
                new { field = "identifierNumber" });
        }
        await ReserveAsync(db, ReservedKinds.OrganizationIdentifier, value, identity.Id, tenantId, cancellationToken);
        if (current is not null)
        {
            identity.PreviousIdentifier = identity.IdentifierShown;
            identity.IdentifierChangedAt = SystemClock.Instance.GetCurrentInstant();
            identity.IdentifierChangedByName = actorName;
        }
        identity.Country = country;
        identity.IdentifierKind = kind;
        identity.IdentifierNumber = number;
        identity.NoIdentifierReason = null;
        changes.Add($"identifier → {identity.IdentifierShown}");
        return null;
    }

    /// <summary>
    /// Folds one organization into another (a duplicate merged, or an entry claimed by the organization it is). Nothing
    /// is deleted: what the merged one held stays reserved and points to the one kept; it takes the merged one's
    /// identifier and domain when it has none; every list holding it now holds the one kept (its code and name, where
    /// the code is free there; a list already holding both keeps both lines, the merged one's under its old code).
    /// </summary>
    public static async Task MergeAsync(DeliosDbContext db, IServiceScopeFactory scopes, OrganizationIdentity keep, OrganizationIdentity merged,
        CancellationToken cancellationToken)
    {
        var now = SystemClock.Instance.GetCurrentInstant();
        merged.MergedIntoId = keep.Id;
        merged.MergedAt = now;
        if (keep.IdentifierNumber is null && merged.IdentifierNumber is not null)
        {
            (keep.Country, keep.IdentifierKind, keep.IdentifierNumber) = (merged.Country, merged.IdentifierKind, merged.IdentifierNumber);
            keep.NoIdentifierReason = null;
        }
        keep.Domain ??= merged.Domain;
        keep.TenantId ??= merged.TenantId;
        await db.ReservedValues.Where(r => r.HolderId == merged.Id).ExecuteUpdateAsync(r => r.SetProperty(x => x.HolderId, keep.Id), cancellationToken);
        var holders = await db.OrganizationHolders.Where(h => h.OrganizationId == merged.Id).ToListAsync(cancellationToken);
        var keepHeldIn = await db.OrganizationHolders.Where(h => h.OrganizationId == keep.Id).Select(h => h.TenantId).ToListAsync(cancellationToken);
        db.OrganizationHolders.RemoveRange(holders);
        foreach (var h in holders) db.OrganizationHolders.Add(new OrganizationHolder { OrganizationId = keep.Id, TenantId = h.TenantId, PartyId = h.PartyId });
        await db.SaveChangesAsync(cancellationToken);
        foreach (var h in holders)
        {
            var renames = !keepHeldIn.Contains(h.TenantId);
            await TenantScope.RunAsync(scopes, h.TenantId, async (_, there) =>
            {
                var party = await there.Parties.SingleOrDefaultAsync(p => p.Id == h.PartyId, cancellationToken);
                if (party is null) return;
                party.OrganizationId = keep.Id;
                if (renames && !await there.Parties.AnyAsync(p => p.Code == keep.Code && p.Id != party.Id, cancellationToken))
                {
                    party.Code = keep.Code;
                    party.Name = keep.Name;
                }
                await there.SaveChangesAsync(cancellationToken);
            }, cancellationToken);
        }
    }

    /// <summary>
    /// Puts what one organization holds in the register when it is not there yet: each party as an organization (by its
    /// code; its own party, when another organization on DELIOS already has that code, takes a free one) and each
    /// project's code and name, when free. Run after migrating (every organization) and after seeding.
    /// </summary>
    public static async Task EnsureTenantAsync(DeliosDbContext db, Guid tenantId, CancellationToken cancellationToken)
    {
        var parties = await db.Parties.Where(p => p.TenantId == tenantId && p.OrganizationId == null)
            .OrderByDescending(p => p.IsInternal).ThenBy(p => p.Code).ToListAsync(cancellationToken);
        foreach (var party in parties)
        {
            var byCode = await HeldAsync(db, ReservedKinds.OrganizationCode, party.Code, cancellationToken);
            var identity = byCode is null ? null : await IdentityAsync(db, byCode.HolderId, cancellationToken);
            var clash = identity is not null && (party.IsInternal ? identity.TenantId is not null && identity.TenantId != tenantId : identity.TenantId == tenantId);
            if (identity is null || clash)
            {
                if (clash) party.Code = await FreeOrganizationCodeAsync(db, party.Code, cancellationToken);
                identity = new OrganizationIdentity
                {
                    Code = Key(party.Code), Name = party.Name, TenantId = party.IsInternal ? tenantId : null, CreatedByTenantId = tenantId,
                    CreatedAt = SystemClock.Instance.GetCurrentInstant(),
                };
                db.OrganizationIdentities.Add(identity);
                await ReserveAsync(db, ReservedKinds.OrganizationCode, party.Code, identity.Id, tenantId, cancellationToken);
                await ReserveAsync(db, ReservedKinds.OrganizationName, party.Name, identity.Id, tenantId, cancellationToken);
            }
            else if (party.IsInternal && identity.TenantId is null) identity.TenantId = tenantId;
            await HoldAsync(db, identity, party, cancellationToken);
        }
        foreach (var project in await db.Projects.Where(p => p.TenantId == tenantId).AsNoTracking().ToListAsync(cancellationToken))
        {
            await ReserveAsync(db, ReservedKinds.ProjectCode, project.Code, project.Id, tenantId, cancellationToken);
            await ReserveAsync(db, ReservedKinds.ProjectName, project.Name, project.Id, tenantId, cancellationToken);
        }
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>Puts every organization's data in the register (after migrating): only what is not there yet.</summary>
    public static async Task EnsureAllAsync(IServiceProvider services, CancellationToken cancellationToken)
    {
        var scopes = services.GetRequiredService<IServiceScopeFactory>();
        List<Guid> tenants;
        await using (var scope = scopes.CreateAsyncScope())
            tenants = await scope.ServiceProvider.GetRequiredService<DeliosDbContext>().Tenants.AsNoTracking()
                .OrderBy(t => t.CreatedAt).Select(t => t.Id).ToListAsync(cancellationToken);
        foreach (var tenant in tenants)
            await TenantScope.RunAsync(scopes, tenant, (_, db) => EnsureTenantAsync(db, tenant, cancellationToken), cancellationToken);
    }
}
