using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Actions;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Records;

public static partial class ProjectRecordEndpoints
{
    // ── Assets ────────────────────────────────────────────────────────────────

    private sealed record AssetView(Guid Id, string Code, string Name, string? Area, string? System, string? Unit, string? Description,
        JsonElement? Extras, bool Active, int Documents);

    private static AssetView View(Asset a, int documents) => new(a.Id, a.Code, a.Name, a.Area, a.System, a.Unit, a.Description,
        a.Extras is null ? null : JsonDocument.Parse(a.Extras).RootElement.Clone(), a.Active, documents);

    private static async Task<IResult> AssetsAsync(HttpContext h, DeliosDbContext db, CancellationToken c, string? q = null, bool all = false)
    {
        var access = ProjectAccessFilter.Of(h);
        var query = db.Set<Asset>().AsNoTracking().Where(a => a.ProjectId == access.Project.Id && (all || a.Active));
        if (!string.IsNullOrWhiteSpace(q))
        {
            var like = $"%{q.Trim()}%";
            query = query.Where(a => EF.Functions.ILike(a.Code, like) || EF.Functions.ILike(a.Name, like)
                || (a.Area != null && EF.Functions.ILike(a.Area, like)) || (a.System != null && EF.Functions.ILike(a.System, like)));
        }
        var rows = await query.OrderBy(a => a.Code).Take(2000)
            .Select(a => new { a, Documents = db.Set<DocumentAsset>().Count(l => l.AssetId == a.Id) }).ToListAsync(c);
        return Results.Ok(rows.Select(x => View(x.a, x.Documents)));
    }

    private static async Task<IResult> AssetAsync(Guid assetId, HttpContext h, DeliosDbContext db, DocumentService documents, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        var asset = await db.Set<Asset>().AsNoTracking().SingleOrDefaultAsync(a => a.Id == assetId && a.ProjectId == access.Project.Id, c);
        if (asset is null) return Problems.NotFound("ASSET_NOT_FOUND", "No such asset.");
        var linked = db.Set<DocumentAsset>().Where(l => l.AssetId == assetId).Select(l => l.DocumentId);
        var docs = await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(c)).AsNoTracking()
            .Where(d => linked.Contains(d.Id)).OrderBy(d => d.Number)
            .Select(d => new
            {
                d.Id,
                d.Number,
                d.Title,
                d.DocType,
                d.Discipline,
                d.State,
                Current = d.Revisions.Where(r => r.State == RevisionStates.Released).Select(r => new { r.Value, r.StatusCode }).FirstOrDefault(),
            }).ToListAsync(c);
        var count = await db.Set<DocumentAsset>().CountAsync(l => l.AssetId == assetId, c);
        return Results.Ok(new { asset = View(asset, count), documents = docs });
    }

    private static async Task<IResult> AddAssetAsync(AssetRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!await KeepsAsync(h, access)) return KeepersOnly("the asset list");
        var code = r.Code?.Trim().ToUpperInvariant() ?? "";
        var name = r.Name?.Trim() ?? "";
        if (code.Length == 0 || name.Length == 0) return Problems.Invalid("CODE_AND_NAME_REQUIRED", "A tag and a name are required.");
        if (await db.Set<Asset>().AnyAsync(a => a.ProjectId == access.Project.Id && a.Code == code, c))
            return Problems.Conflict("ASSET_EXISTS", $"{code} is already in the list.");
        var asset = new Asset
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            Code = code,
            Name = name,
            Area = Blank(r.Area),
            System = Blank(r.System),
            Unit = Blank(r.Unit),
            Description = Blank(r.Description),
            Extras = OwnFields.Write(null, r.Extras),
            CreatedAt = clock.GetCurrentInstant(),
        };
        db.Add(asset);
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "ASSET_ADDED", "Asset", asset.Id, code, name, access.Project.Id, c);
        return Results.Created($"/api/projects/{access.Project.Id}/assets/{asset.Id}", View(asset, 0));
    }

    private static async Task<IResult> UpdateAssetAsync(Guid assetId, AssetRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!await KeepsAsync(h, access)) return KeepersOnly("the asset list");
        var asset = await db.Set<Asset>().SingleOrDefaultAsync(a => a.Id == assetId && a.ProjectId == access.Project.Id, c);
        if (asset is null) return Problems.NotFound("ASSET_NOT_FOUND", "No such asset.");
        var name = r.Name?.Trim() ?? "";
        if (name.Length == 0) return Problems.Invalid("NAME_REQUIRED", "An asset needs a name.");
        var was = asset.Name;
        // The tag itself does not change: documents and drawings cite it.
        asset.Name = name;
        asset.Area = Blank(r.Area);
        asset.System = Blank(r.System);
        asset.Unit = Blank(r.Unit);
        asset.Description = Blank(r.Description);
        if (r.Extras is not null) asset.Extras = OwnFields.Write(asset.Extras, r.Extras);
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "ASSET_UPDATED", "Asset", asset.Id, asset.Code, was == name ? "Details changed." : $"{was} → {name}",
            access.Project.Id, c);
        return Results.Ok(View(asset, await db.Set<DocumentAsset>().CountAsync(l => l.AssetId == assetId, c)));
    }

    private static async Task<IResult> RetireAssetAsync(Guid assetId, HttpContext h, DeliosDbContext db, AuditLog audit, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!await KeepsAsync(h, access)) return KeepersOnly("the asset list");
        var asset = await db.Set<Asset>().SingleOrDefaultAsync(a => a.Id == assetId && a.ProjectId == access.Project.Id, c);
        if (asset is null) return Problems.NotFound("ASSET_NOT_FOUND", "No such asset.");
        var links = await db.Set<DocumentAsset>().CountAsync(l => l.AssetId == assetId, c);
        if (links > 0) return Problems.Conflict("ASSET_IN_USE", $"{asset.Code} describes {links} document{(links == 1 ? "" : "s")}; unlink them first.");
        asset.Active = false;
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "ASSET_RETIRED", "Asset", asset.Id, asset.Code, "Retired while unused; kept on record.", access.Project.Id, c);
        return Results.NoContent();
    }

    private static async Task<IResult> DocumentAssetsAsync(Guid documentId, HttpContext h, DeliosDbContext db, DocumentService documents, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(c)).AnyAsync(d => d.Id == documentId, c))
            return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        return Results.Ok(await (from l in db.Set<DocumentAsset>()
                                 join a in db.Set<Asset>() on l.AssetId equals a.Id
                                 where l.DocumentId == documentId
                                 orderby a.Code
                                 select new { l.Id, AssetId = a.Id, a.Code, a.Name, CreatedBy = l.CreatedByName, l.CreatedAt }).ToListAsync(c));
    }

    private static async Task<IResult> LinkAssetAsync(Guid documentId, LinkAssetRequest r, HttpContext h, DeliosDbContext db, DocumentService documents,
        AuditLog audit, IClock clock, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        var document = await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(c)).SingleOrDefaultAsync(d => d.Id == documentId, c);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        if (!MayEdit(access, document)) return Problems.Forbidden("EDIT_NOT_ALLOWED", "Your function on this project cannot change this document's details.");
        var code = r.AssetCode?.Trim().ToUpperInvariant() ?? "";
        if (code.Length == 0) return Problems.Invalid("ASSET_REQUIRED", "Enter an asset code.");
        var asset = await db.Set<Asset>().SingleOrDefaultAsync(a => a.ProjectId == access.Project.Id && a.Code == code && a.Active, c);
        if (asset is null) return Problems.Invalid("ASSET_UNKNOWN", $"Asset \"{code}\" is not in the asset breakdown.");
        if (await db.Set<DocumentAsset>().AnyAsync(l => l.DocumentId == documentId && l.AssetId == asset.Id, c))
            return Problems.Conflict("ALREADY_LINKED", "Already associated with this asset.");
        db.Add(new DocumentAsset
        {
            TenantId = document.TenantId,
            ProjectId = document.ProjectId,
            DocumentId = document.Id,
            AssetId = asset.Id,
            CreatedByName = access.UserName,
            CreatedAt = clock.GetCurrentInstant(),
        });
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "RELATIONSHIP", "Document", document.Id, document.Number, $"Associated with asset {asset.Code} — {asset.Name}.",
            access.Project.Id, c);
        return Results.NoContent();
    }

    private static async Task<IResult> UnlinkAssetAsync(Guid linkId, HttpContext h, DeliosDbContext db, DocumentService documents, AuditLog audit, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        var link = await db.Set<DocumentAsset>().SingleOrDefaultAsync(l => l.Id == linkId && l.ProjectId == access.Project.Id, c);
        if (link is null) return Results.NoContent();
        var document = await DocumentQueries.Visible(db, access, await documents.RestrictedAsync(c)).SingleOrDefaultAsync(d => d.Id == link.DocumentId, c);
        if (document is null) return Problems.NotFound("DOCUMENT_NOT_FOUND", "No such document.");
        if (!MayEdit(access, document)) return Problems.Forbidden("EDIT_NOT_ALLOWED", "Your function on this project cannot change this document's details.");
        var code = await db.Set<Asset>().Where(a => a.Id == link.AssetId).Select(a => a.Code).SingleAsync(c);
        db.Remove(link);
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "RELATIONSHIP", "Document", document.Id, document.Number, $"No longer associated with asset {code}.",
            access.Project.Id, c);
        return Results.NoContent();
    }

    /// <summary>
    /// The documents an asset describes, set from its page (the register opened for it, as for an action): what is
    /// ticked is linked, what is unticked is unlinked. Whoever keeps the asset list does it; each change is logged on
    /// the document.
    /// </summary>
    private static async Task<IResult> SetAssetDocumentsAsync(Guid assetId, AssetDocumentsRequest r, HttpContext h, DeliosDbContext db,
        DocumentService documents, AuditLog audit, IClock clock, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!await KeepsAsync(h, access)) return KeepersOnly("the asset list");
        var asset = await db.Set<Asset>().SingleOrDefaultAsync(a => a.Id == assetId && a.ProjectId == access.Project.Id && a.Active, c);
        if (asset is null) return Problems.NotFound("ASSET_NOT_FOUND", "No such asset.");
        var adding = r.Add?.Distinct().ToList() ?? [];
        var removing = r.Remove?.Distinct().Except(adding).ToList() ?? [];
        if (adding.Count == 0 && removing.Count == 0) return Problems.Invalid("NOTHING_CHANGED", "Tick a document to link it, untick one to unlink it.");
        var visible = DocumentQueries.Visible(db, access, await documents.RestrictedAsync(c));
        var found = await visible.Where(d => adding.Contains(d.Id) || removing.Contains(d.Id)).Select(d => new { d.Id, d.Number, d.TenantId, d.ProjectId })
            .ToDictionaryAsync(d => d.Id, c);
        var missing = adding.Concat(removing).Where(id => !found.ContainsKey(id)).ToList();
        if (missing.Count > 0) return Problems.Invalid("DOCUMENT_NOT_FOUND", "Some documents are not on this project.", new { documentIds = missing });
        var have = await db.Set<DocumentAsset>().Where(l => l.AssetId == assetId && (adding.Contains(l.DocumentId) || removing.Contains(l.DocumentId)))
            .ToListAsync(c);
        var now = clock.GetCurrentInstant();
        foreach (var id in adding.Where(id => have.All(l => l.DocumentId != id)))
        {
            var d = found[id];
            db.Add(new DocumentAsset { TenantId = d.TenantId, ProjectId = d.ProjectId, DocumentId = d.Id, AssetId = asset.Id, CreatedByName = access.UserName, CreatedAt = now });
            await audit.WriteAsync(Who(access), "RELATIONSHIP", "Document", d.Id, d.Number, $"Associated with asset {asset.Code} — {asset.Name}.", access.Project.Id, c);
        }
        foreach (var link in have.Where(l => removing.Contains(l.DocumentId)))
        {
            db.Remove(link);
            var d = found[link.DocumentId];
            await audit.WriteAsync(Who(access), "RELATIONSHIP", "Document", d.Id, d.Number, $"No longer associated with asset {asset.Code}.", access.Project.Id, c);
        }
        await db.SaveChangesAsync(c);
        return Results.NoContent();
    }

    private static bool MayEdit(ProjectAccess a, Document d) => a.IsInternal
        && (a.Allows(Verbs.Create, d.Facts) || a.Allows(Verbs.Revise, d.Facts) || a.Allows(Verbs.Control, d.Facts));
}
