using Delios.Host.Identity;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Packages;

/// <summary>What a package's view is made of, beside the package itself.</summary>
public sealed record PackageParts(List<PackageService.Readiness> Readiness, IReadOnlyList<PackageTransmittal> Transmittals, IntakeView? Intake,
    string? SupplierName, IReadOnlyList<string>? SupplierPeople, PackageNames Names, PackagePlace? Place);

public sealed partial class PackageService
{
    /// <summary>One package's view parts, read for it alone (a package's page, the answer to an act on it).</summary>
    public async Task<PackageParts> PartsAsync(Package p, bool outside, ProjectAccess? access, CancellationToken cancellationToken)
    {
        var readiness = await ReadinessAsync(p, cancellationToken);
        var transmittals = await TransmittalsAsync(p, cancellationToken);
        var intake = p.Kind == PackageKinds.Supply ? await IntakeAsync(p.ProjectId, cancellationToken) : null;
        return new PackageParts(readiness, transmittals, intake, await SupplierNameAsync(p, cancellationToken),
            outside ? null : (await SupplierPeopleAsync(p, cancellationToken)).Select(x => x.Name).ToList(),
            await NamesAsync(p, transmittals, cancellationToken),
            access is null ? null : await PlaceAsync(access, p, cancellationToken));
    }

    /// <summary>
    /// Every package of one kind the reader sees, brought up to date with its rule, with what its view shows: worked out
    /// in a few reads whatever their number (owner: "a page never reads its lines one by one"). Only a package in a tree
    /// reads its tree on its own.
    /// </summary>
    public async Task<List<(Package Package, PackageParts Parts)>> ListedAsync(ProjectAccess access, string? kind, CancellationToken cancellationToken)
    {
        if (!access.Holds(Verbs.Read)) return [];
        if (access.IsInternal && (access.Holds(Verbs.Control) || await StandIns.NoControlAsync(db, access.Project.Id, cancellationToken)))
            await filing.FileUnfiledAsync(access.Project, Actor(access), cancellationToken);
        var packages = await Visible(access).Where(p => kind == null || p.Kind == kind)
            .OrderByDescending(p => p.CreatedAt).Take(5000).Include(p => p.Members).AsSplitQuery().ToListAsync(cancellationToken);
        if (packages.Count == 0) return [];

        // Which sit in a tree: one look for the whole project.
        var linked = await db.Packages.AsNoTracking().Where(p => p.ProjectId == access.Project.Id && p.ParentId != null)
            .Select(p => new { p.Id, Parent = p.ParentId!.Value }).ToListAsync(cancellationToken);
        var parents = linked.Select(l => l.Parent).ToHashSet();
        var inTree = linked.Select(l => l.Id).Concat(parents).ToHashSet();

        // Brought up to date: what a rule now admits joins, and what a package under it holds goes down.
        var changed = false;
        foreach (var package in packages)
        {
            var handed = parents.Contains(package.Id) && await HandDownAsync(package, cancellationToken);
            var synced = package.Rule is { IsEmpty: false } && package.State == PackageStates.Open && package.RuleCeasedAt is null
                && await SyncAsync(package, cancellationToken) > 0;
            if (handed || synced) { ResetAssessment(package); changed = true; }
        }
        if (changed) await db.SaveChangesAsync(cancellationToken);

        var outside = !access.IsInternal;
        var (documents, released) = await ReadinessFactsAsync(packages.SelectMany(p => p.Members).Select(m => m.DocumentId).Distinct().ToList(), cancellationToken);

        // Transmittals: those made for each package, and for a supplier's, what that supplier sent carrying its documents.
        var ids = packages.Select(p => p.Id).ToList();
        var own = await db.Transmittals.AsNoTracking().Where(t => t.PackageId != null && ids.Contains(t.PackageId.Value))
            .Select(t => new { Package = t.PackageId!.Value, Line = new PackageTransmittal(t.Id, t.Number, t.Direction, t.IssuedAt.ToDateTimeOffset(), t.Items.Count) })
            .ToListAsync(cancellationToken);
        var suppliers = packages.Where(p => p.Kind == PackageKinds.Supply && p.SupplierPartyId != null).Select(p => p.SupplierPartyId!.Value).Distinct().ToList();
        var incoming = suppliers.Count == 0 ? [] : await db.Transmittals.AsNoTracking()
            .Where(t => t.ProjectId == access.Project.Id && t.Direction == TransmittalDirections.Incoming && t.FromPartyId != null && suppliers.Contains(t.FromPartyId.Value))
            .Select(t => new
            {
                From = t.FromPartyId!.Value,
                Documents = t.Items.Where(i => i.DocumentId != null).Select(i => i.DocumentId!.Value).ToList(),
                Line = new PackageTransmittal(t.Id, t.Number, t.Direction, t.IssuedAt.ToDateTimeOffset(), t.Items.Count),
            }).ToListAsync(cancellationToken);

        var intake = packages.Any(p => p.Kind == PackageKinds.Supply) ? await IntakeAsync(access.Project.Id, cancellationToken) : null;
        var people = packages.SelectMany(p => p.OwnerIds.Concat(p.AcceptorIds)).Distinct().ToList();
        var names = await db.Users.AsNoTracking().Where(u => people.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Name, cancellationToken);
        var partyIds = packages.SelectMany(p => p.RecipientPartyIds).Concat(suppliers).Distinct().ToList();
        var parties = await db.Parties.AsNoTracking().Where(p => partyIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, cancellationToken);
        var us = await db.Tenants.AsNoTracking().Where(t => t.Id == packages[0].TenantId).Select(t => t.Name).FirstOrDefaultAsync(cancellationToken) ?? "us";
        // The supplier's people on the project (active, not waiting for confirmation), for our own readers.
        var supplierPeople = outside || suppliers.Count == 0 ? [] : (await (from u in db.Users
                    join m in db.Memberships on u.Id equals m.UserId
                    where u.PartyId != null && suppliers.Contains(u.PartyId.Value) && u.Active && m.ProjectId == access.Project.Id && m.Active && m.PendingSince == null
                    select new { Party = u.PartyId!.Value, u.Id, u.Name }).Distinct().AsNoTracking().ToListAsync(cancellationToken))
            .GroupBy(x => x.Party).ToDictionary(g => g.Key, g => g.Select(x => x.Name).ToList());

        var listed = new List<(Package, PackageParts)>();
        foreach (var p in packages)
        {
            var readiness = ReadinessOf(p, documents, released);
            var members = p.Members.Select(m => m.DocumentId).ToHashSet();
            var transmittals = own.Where(t => t.Package == p.Id).Select(t => t.Line)
                .Concat(p.Kind == PackageKinds.Supply ? incoming.Where(t => t.From == p.SupplierPartyId && t.Documents.Any(members.Contains)).Select(t => t.Line) : [])
                .DistinctBy(t => t.Id).OrderBy(t => t.IssuedAt).ToList();
            var place = inTree.Contains(p.Id) ? await PlaceAsync(access, p, cancellationToken) : Alone(p, readiness, outside);
            listed.Add((p, new PackageParts(readiness, transmittals, p.Kind == PackageKinds.Supply ? intake : null,
                p.SupplierPartyId is { } s ? parties.GetValueOrDefault(s)?.Name : null,
                outside ? null : p.SupplierPartyId is { } sp ? supplierPeople.GetValueOrDefault(sp) ?? [] : [],
                NamesOf(p, transmittals, names, parties, us), place)));
        }
        return listed;
    }

    /// <summary>A package in no tree: its own documents counted, what another organization reads only what was asked of it.</summary>
    private static PackagePlace Alone(Package package, List<Readiness> readiness, bool outside)
    {
        var lines = readiness.Where(r => !outside || r.Member.RequestedAt != null).ToList();
        var documents = lines.Select(r => r.Member.DocumentId).Distinct().ToList();
        return new PackagePlace(null, [], [], new PackageTally(0, 0, documents.Count,
            lines.Where(r => r.Ready).Select(r => r.Member.DocumentId).Distinct().Count(),
            lines.Where(r => r.RevisionId != null).Select(r => r.Member.DocumentId).Distinct().Count()));
    }
}
