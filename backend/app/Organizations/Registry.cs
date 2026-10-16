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
}

/// <summary>Which organization's list holds an organization, as which of its parties: where a change is carried to.</summary>
public sealed class OrganizationHolder
{
    public Guid OrganizationId { get; set; }
    public Guid TenantId { get; set; }
    public Guid PartyId { get; set; }
}

internal sealed class RegistryConfiguration :
    IEntityTypeConfiguration<ReservedValue>, IEntityTypeConfiguration<OrganizationIdentity>, IEntityTypeConfiguration<OrganizationHolder>
{
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
    }

    public void Configure(EntityTypeBuilder<OrganizationHolder> b)
    {
        b.HasKey(x => new { x.OrganizationId, x.TenantId });
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
            var identity = new OrganizationIdentity { Code = code, Name = name.Trim(), TenantId = ownTenant, CreatedAt = SystemClock.Instance.GetCurrentInstant() };
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

    public static async Task<OrganizationIdentity?> IdentityAsync(DeliosDbContext db, Guid id, CancellationToken cancellationToken) =>
        db.OrganizationIdentities.Local.FirstOrDefault(o => o.Id == id) ?? await db.OrganizationIdentities.FindAsync([id], cancellationToken);

    /// <summary>Notes that this organization's list holds the organization, as this party.</summary>
    public static async Task HoldAsync(DeliosDbContext db, OrganizationIdentity identity, Party party, CancellationToken cancellationToken)
    {
        party.OrganizationId = identity.Id;
        var held = db.OrganizationHolders.Local.FirstOrDefault(h => h.OrganizationId == identity.Id && h.TenantId == party.TenantId)
            ?? await db.OrganizationHolders.SingleOrDefaultAsync(h => h.OrganizationId == identity.Id && h.TenantId == party.TenantId, cancellationToken);
        if (held is null) db.OrganizationHolders.Add(new OrganizationHolder { OrganizationId = identity.Id, TenantId = party.TenantId, PartyId = party.Id });
        else held.PartyId = party.Id;
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
                    Code = Key(party.Code), Name = party.Name, TenantId = party.IsInternal ? tenantId : null, CreatedAt = SystemClock.Instance.GetCurrentInstant(),
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
