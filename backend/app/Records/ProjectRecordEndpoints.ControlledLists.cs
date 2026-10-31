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
    // ── Uploaded lists for a decision ─────────────────────────────────────────

    private static async Task<IResult> ControlledListAsync(DeliosDbContext db, Guid? projectId, string? kind, string? key, CancellationToken c)
    {
        var query = db.Set<ControlledVersion>().AsNoTracking().Where(v => v.ProjectId == projectId);
        if (!string.IsNullOrEmpty(kind)) query = query.Where(v => v.Kind == kind);
        if (!string.IsNullOrEmpty(key)) query = query.Where(v => v.Key == key);
        var rows = await query.OrderByDescending(v => v.CreatedAt).Take(500).ToListAsync(c);
        return Results.Ok(rows.Select(ControlledView));
    }

    private static object ControlledView(ControlledVersion v) => new
    {
        v.Id,
        v.ProjectId,
        v.Kind,
        v.Key,
        v.Title,
        v.VersionLabel,
        v.State,
        v.SubmittedById,
        v.RowCount,
        v.SourceName,
        v.SourceSize,
        v.SourceHash,
        v.Notes,
        Payload = JsonDocument.Parse(v.Payload).RootElement.Clone(),
        Diff = v.Diff is null ? (JsonElement?)null : JsonDocument.Parse(v.Diff).RootElement.Clone(),
        CreatedBy = v.CreatedByName,
        CreatedById = v.CreatedById,
        CreatedAt = v.CreatedAt.ToDateTimeOffset(),
        SubmittedBy = v.SubmittedByName,
        SubmittedAt = v.SubmittedAt?.ToDateTimeOffset(),
        DecidedBy = v.DecidedByName,
        DecidedAt = v.DecidedAt?.ToDateTimeOffset(),
        v.DecisionReason,
        AppliedAt = v.AppliedAt?.ToDateTimeOffset(),
        v.AppliedSummary,
        SupersededAt = v.SupersededAt?.ToDateTimeOffset(),
    };

    /// <summary>Who keeps controlled lists: whoever configures the organization, or the control function on some project.</summary>
    private static async Task<bool> MayControlAsync(HttpContext h, DeliosDbContext db, Guid? projectId)
    {
        if (await Keepers.ConfiguresAsync(h)) return true;
        // The organization's own lists are an administrator's: the control function of one project does not answer for all.
        if (projectId is null) return false;
        var me = h.User.UserId();
        return await db.Memberships.AnyAsync(m => m.UserId == me && m.Active && (projectId == null || m.ProjectId == projectId)
            && m.Function!.Active && (m.ActsAsControl || db.PermissionRules.IgnoreQueryFilters().Any(r => r.FunctionId == m.FunctionId && r.ProjectId == (m.Project!.OwnFunctions ? (Guid?)m.ProjectId : null) && r.Verbs.Contains(Verbs.Control))), h.RequestAborted);
    }

    private static async Task<IResult> UploadAsync(HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, Guid? projectId,
        ControlledUpload r, CancellationToken c)
    {
        if (!await MayControlAsync(h, db, projectId)) return Problems.Forbidden("CONTROL_ONLY", "The control function or an administrator uploads a controlled list.");
        var kind = r.Kind?.Trim() ?? "";
        var key = string.IsNullOrWhiteSpace(r.Key) ? "default" : r.Key.Trim();
        if (kind.Length == 0) return Problems.Invalid("KIND_REQUIRED", "Say which list this is.");
        var labels = await db.Set<ControlledVersion>().Where(v => v.ProjectId == projectId && v.Kind == kind && v.Key == key)
            .Select(v => v.VersionLabel).ToListAsync(c);
        var next = labels.Select(l => int.TryParse(l.TrimStart('v'), out var n) ? n : 0).DefaultIfEmpty(0).Max() + 1;
        // The uploader names the version; a name is never reused.
        var label = Blank(r.VersionLabel) ?? $"v{next}";
        if (label.Length > 16) return Problems.Invalid("LABEL_TOO_LONG", "A version label is at most 16 characters.");
        if (labels.Contains(label)) return Problems.Conflict("LABEL_TAKEN", $"Version {label} already exists here. Labels are never reused.");
        var pending = await db.Set<ControlledVersion>().AsNoTracking()
            .Where(v => v.ProjectId == projectId && v.Kind == kind && v.Key == key && (v.State == "DRAFT" || v.State == "SUBMITTED"))
            .Select(v => new { v.VersionLabel, v.State }).FirstOrDefaultAsync(c);
        if (pending is not null)
            return Problems.Conflict("VERSION_PENDING", $"{pending.VersionLabel} is already {pending.State.ToLowerInvariant()} here. Decide on it before uploading another.");
        var me = await db.Users.AsNoTracking().SingleAsync(u => u.Id == h.User.UserId(), c);
        var version = new ControlledVersion
        {
            TenantId = h.User.TenantId(),
            ProjectId = projectId,
            Kind = kind,
            Key = key,
            Title = Blank(r.Title) ?? kind,
            VersionLabel = label,
            Payload = r.Payload.GetRawText(),
            Diff = r.Diff?.GetRawText(),
            RowCount = r.RowCount,
            SourceName = Blank(r.SourceName),
            SourceSize = r.SourceSize,
            SourceHash = Blank(r.SourceHash),
            Notes = Blank(r.Notes),
            CreatedById = me.Id,
            CreatedByName = me.Name,
            CreatedAt = clock.GetCurrentInstant(),
        };
        db.Add(version);
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(new Actor(me.Id, me.Name), "CONTROLLED_UPLOADED", "ControlledVersion", version.Id, $"{kind} {version.VersionLabel}",
            $"{r.RowCount} rows{(version.SourceName is null ? "" : $" from {version.SourceName}")}.", projectId, c);
        return Results.Ok(ControlledView(version));
    }

    private static async Task<(ControlledVersion? Version, User? Me, IResult? Problem)> LoadVersionAsync(HttpContext h, DeliosDbContext db, Guid id, CancellationToken c)
    {
        var version = await db.Set<ControlledVersion>().SingleOrDefaultAsync(v => v.Id == id, c);
        if (version is null) return (null, null, Problems.NotFound("VERSION_NOT_FOUND", "No such version."));
        if (!await MayControlAsync(h, db, version.ProjectId)) return (null, null, Problems.Forbidden("CONTROL_ONLY", "The control function or an administrator decides a controlled list."));
        var me = await db.Users.AsNoTracking().SingleAsync(u => u.Id == h.User.UserId(), c);
        return (version, me, null);
    }

    private static async Task<IResult> SubmitAsync(Guid versionId, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c)
    {
        var (version, me, problem) = await LoadVersionAsync(h, db, versionId, c);
        if (problem is not null) return problem;
        if (version!.State != "DRAFT") return Problems.Conflict("NOT_A_DRAFT", "Only a draft is submitted.");
        version.State = "SUBMITTED";
        version.SubmittedById = me!.Id;
        version.SubmittedByName = me.Name;
        version.SubmittedAt = clock.GetCurrentInstant();
        await audit.WriteAsync(new Actor(me.Id, me.Name), "CONTROLLED_SUBMITTED", "ControlledVersion", version.Id, $"{version.Kind} {version.VersionLabel}",
            null, version.ProjectId, c);
        await db.SaveChangesAsync(c);
        return Results.Ok(ControlledView(version));
    }

    /// <summary>
    /// Approves (once its contents are applied, which the caller has done and summarizes) or rejects a submitted
    /// version. The approved one supersedes the version in force.
    /// </summary>
    private static async Task<IResult> DecideAsync(Guid versionId, ControlledDecision r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken c)
    {
        var (version, me, problem) = await LoadVersionAsync(h, db, versionId, c);
        if (problem is not null) return problem;
        if (version!.State is not ("SUBMITTED" or "DRAFT")) return Problems.Conflict("ALREADY_DECIDED", "That version has been decided.");
        if (!r.Approve && Blank(r.Reason) is null) return Problems.Invalid("REASON_REQUIRED", "Say why it is rejected.");
        var now = clock.GetCurrentInstant();
        version.DecidedByName = me!.Name;
        version.DecidedAt = now;
        version.DecisionReason = Blank(r.Reason);
        version.SubmittedAt ??= now;
        version.SubmittedByName ??= me.Name;
        version.SubmittedById ??= me.Id;
        if (r.Approve)
        {
            foreach (var before in await db.Set<ControlledVersion>().Where(v => v.ProjectId == version.ProjectId && v.Kind == version.Kind
                && v.Key == version.Key && v.State == "APPROVED").ToListAsync(c))
            {
                before.State = "SUPERSEDED";
                before.SupersededAt = now;
            }
            version.State = "APPROVED";
            version.AppliedAt = now;
            version.AppliedSummary = Blank(r.AppliedSummary);
        }
        else version.State = "REJECTED";
        await audit.WriteAsync(new Actor(me.Id, me.Name), r.Approve ? "CONTROLLED_APPROVED" : "CONTROLLED_REJECTED", "ControlledVersion", version.Id,
            $"{version.Kind} {version.VersionLabel}", r.Approve ? version.AppliedSummary : version.DecisionReason, version.ProjectId, c);
        await db.SaveChangesAsync(c);
        return Results.Ok(ControlledView(version));
    }

    private static async Task<IResult> DiscardAsync(Guid versionId, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c)
    {
        var (version, me, problem) = await LoadVersionAsync(h, db, versionId, c);
        if (problem is not null) return problem;
        if (version!.State is not ("DRAFT" or "SUBMITTED")) return Problems.Conflict("ALREADY_DECIDED", "That version has been decided.");
        // Kept, marked so: an upload is part of the record even when nobody went on with it.
        version.State = "REJECTED";
        version.DecidedByName = me!.Name;
        version.DecidedAt = clock.GetCurrentInstant();
        version.DecisionReason = "Discarded by whoever uploaded it, before a decision.";
        await audit.WriteAsync(new Actor(me.Id, me.Name), "CONTROLLED_DISCARDED", "ControlledVersion", version.Id, $"{version.Kind} {version.VersionLabel}",
            null, version.ProjectId, c);
        await db.SaveChangesAsync(c);
        return Results.NoContent();
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
