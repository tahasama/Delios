using System.Security.Cryptography;
using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Records;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Schedules;

/// <summary>
/// A schedule list's file uploaded on Schedule &amp; actions: which list, the file, and either the released revision
/// it is the list of, or the uploader's word that there is no such document.
/// </summary>
public sealed record ListUploadRequest(string Kind, string FileName, string ContentBase64, Guid? RevisionId = null, bool Aware = false, string? Reason = null, bool Confirmed = false);

/// <summary>
/// The schedule's three lists — the schedule, the disciplines per action, the document requirements — are documents
/// in the register; their revisions are made, reviewed and released there, never here. Here Document Control uploads
/// the spreadsheet of the revision in force: it is read and applied at once, all or nothing, and recorded against that
/// revision. The uploader confirms the file is that revision's list as released, taking responsibility for it
/// matching, or says why it differs. Where a project has no such
/// document, a list may be uploaded on its own, with the uploader's word that they know it is not a register
/// document and why. Every upload keeps the uploader, the file's fingerprint and its rows among the uploaded lists and
/// in the audit trail.
/// </summary>
public static class ListUploadEndpoints
{
    private const int MaxBytes = 20 * 1024 * 1024;

    private static readonly Dictionary<string, (string Kind, string Title)> Lists = new(StringComparer.OrdinalIgnoreCase)
    {
        ["SCHEDULE"] = ("SCHEDULE", "Schedule"),
        ["DEPARTMENTS"] = (DepartmentsImporter.Kind, "Disciplines per action"),
        ["REQUIREMENTS"] = (RequirementsImporter.Kind, "Document requirements"),
    };

    /// <summary>Registers POST /api/projects/{projectId}/schedule/lists. Called once at startup from PlatformSetup.</summary>
    public static void MapListUploadEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGroup("/api/projects/{projectId:guid}").WithTags("Schedule")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>()
            .MapPost("/schedule/lists", UploadAsync);
    }

    private static async Task<IResult> UploadAsync(
        ListUploadRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        ScheduleImporter schedules, DepartmentsImporter departments, RequirementsImporter requirements, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal || !(access.Holds(Verbs.Control) || access.Holds(Verbs.Plan)))
            return Problems.Forbidden("PLAN_NOT_ALLOWED", "Your function does not upload the schedule's lists. Document Control, or a function given Plan, does.");
        if (!Lists.TryGetValue(request.Kind ?? "", out var list)) return Problems.Invalid("LIST_UNKNOWN", "Choose the schedule, the disciplines per action or the document requirements.");
        var project = access.Project;
        var reason = request.Reason?.Trim() ?? "";

        // The released revision the file is the list of, or none, knowingly.
        Revision? revision = null;
        string? label = null;
        if (request.RevisionId is { } revisionId)
        {
            revision = await db.Revisions.AsNoTracking().SingleOrDefaultAsync(r => r.Id == revisionId && r.ProjectId == project.Id, cancellationToken);
            if (revision is null) return Problems.NotFound("REVISION_NOT_FOUND", "No such revision.");
            if (revision.State != RevisionStates.Released)
                return Problems.Conflict("REVISION_NOT_RELEASED", $"Rev {revision.Value} is not the released revision. Upload the list of the revision in force.");
            var document = await db.Documents.AsNoTracking().SingleAsync(d => d.Id == revision.DocumentId, cancellationToken);
            label = $"{document.Number} rev {revision.Value}";
            var source = await db.ScheduleSources.SingleOrDefaultAsync(s => s.ProjectId == project.Id, cancellationToken);
            var fits = list.Kind switch
            {
                "SCHEDULE" => source is null ? document.DocType == "SCH" : source.DocumentId == document.Id,
                DepartmentsImporter.Kind => await DepartmentsImporter.IsListAsync(db, document.Id, cancellationToken),
                _ => await RequirementsImporter.IsListAsync(db, document.Id, cancellationToken),
            };
            if (!fits) return Problems.Invalid("NOT_THIS_LIST", $"{document.Number} does not hold the {list.Title.ToLowerInvariant()}.");
            // The uploader vouches for the file, or says why it is not the released revision's list as it stands.
            if (!request.Confirmed && reason.Length == 0)
                return Problems.Invalid("CONFIRM_OR_REASON", $"Tick that this file is the list of {label} as released, or say why it differs.");
            // The first schedule upload names the project's schedule document.
            if (list.Kind == "SCHEDULE" && source is null)
                db.ScheduleSources.Add(new ScheduleSource { TenantId = project.TenantId, ProjectId = project.Id, DocumentId = document.Id });
        }
        else
        {
            if (reason.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why it is uploaded without a register document: it is kept with the upload.");
        }

        byte[] bytes;
        try { bytes = Convert.FromBase64String(request.ContentBase64 ?? ""); }
        catch (FormatException) { return Problems.Invalid("FILE_UNREADABLE", "The file did not arrive whole. Try again."); }
        if (bytes.Length == 0) return Problems.Invalid("FILE_EMPTY", "The file is empty.");
        if (bytes.Length > MaxBytes) return Problems.Invalid("FILE_TOO_LARGE", "The file is larger than 20 MB.");
        var fileName = Path.GetFileName(request.FileName ?? "list.csv");
        if (!ScheduleReader.CanRead(fileName)) return Problems.Invalid("FILE_TYPE", "Upload the list as .xlsx or .csv.");
        await db.SaveChangesAsync(cancellationToken);

        string? summary;
        IReadOnlyList<string> problems;
        switch (list.Kind)
        {
            case "SCHEDULE":
                var (applied, error) = await schedules.ReadUploadAsync(project.TenantId, project.Id, fileName, bytes, revision, cancellationToken);
                (summary, problems) = (applied, error is null ? [] : [error]);
                break;
            case DepartmentsImporter.Kind:
                (summary, var tagged) = await departments.ReadUploadAsync(project, fileName, bytes, cancellationToken);
                problems = tagged;
                break;
            default:
                (summary, problems) = await requirements.ReadUploadAsync(project, fileName, bytes, cancellationToken);
                break;
        }
        if (problems.Count > 0)
        {
            // Nothing is applied: the transaction is dropped with the refusal.
            var shown = string.Join(" ", problems.Take(5)) + (problems.Count > 5 ? $" … and {problems.Count - 5} more." : "");
            return Problems.Invalid("LIST_NOT_READ", $"Nothing was applied. {shown}", new { problems });
        }

        List<string[]> rows;
        using (var content = new MemoryStream(bytes)) rows = ScheduleReader.ReadRows(content, fileName);
        var now = clock.GetCurrentInstant();
        // Each upload keeps its own label, unique within its list: "rev B", then "rev B (2)" for the same
        // revision read again; "upload 1", "upload 2"… for lists with no document.
        var stem = revision is null ? "upload" : $"rev {revision.Value}";
        var taken = (await db.Set<ControlledVersion>().AsNoTracking()
            .Where(v => v.ProjectId == project.Id && v.Kind == list.Kind && v.Key == "default" && v.VersionLabel != null && v.VersionLabel.StartsWith(stem))
            .Select(v => v.VersionLabel!).ToListAsync(cancellationToken)).ToHashSet();
        var versionLabel = revision is null ? "upload 1" : stem;
        for (var n = 2; taken.Contains(versionLabel); n++) versionLabel = revision is null ? $"upload {n}" : $"{stem} ({n})";
        if (versionLabel.Length > 16) versionLabel = $"upload {taken.Count + 1}";
        var note = summary is { Length: > 2000 } ? summary[..2000] : summary;
        db.Add(new ControlledVersion
        {
            TenantId = project.TenantId,
            ProjectId = project.Id,
            Kind = list.Kind,
            Key = "default",
            Title = list.Title,
            VersionLabel = versionLabel,
            State = "APPROVED",
            Payload = JsonSerializer.Serialize(rows),
            RowCount = Math.Max(rows.Count - 1, 0),
            // The released revision's label marks its list as read; a list with no document keeps its file name.
            SourceName = label ?? fileName,
            SourceSize = bytes.Length,
            SourceHash = Convert.ToHexStringLower(SHA256.HashData(bytes)),
            Notes = note,
            CreatedById = access.UserId,
            CreatedByName = access.UserName,
            CreatedAt = now,
            DecidedByName = access.UserName,
            DecidedAt = now,
            DecisionReason = reason.Length == 0 ? null : reason.Length > 2000 ? reason[..2000] : reason,
            AppliedAt = now,
            AppliedSummary = note,
        });
        await db.SaveChangesAsync(cancellationToken);
        var said = revision is null
            ? $"{list.Title} uploaded without a register document. {access.UserName} confirmed they know it is not a controlled document. Why: {reason} {summary}"
            : $"{list.Title} of {label} read from {fileName}, uploaded by {access.UserName}."
              + (request.Confirmed ? $" {access.UserName} confirms it is the list of {label} as released and takes responsibility for it matching." : "")
              + (reason.Length > 0 ? $" Differs from {label} as released; why: {reason}." : "") + $" {summary}";
        await audit.WriteAsync(http.User.Actor(), revision is null ? "LIST_UPLOADED_WITHOUT_DOCUMENT" : "LIST_READ_FROM_UPLOAD",
            revision is null ? "Project" : "Revision", revision?.Id ?? project.Id, label ?? $"{list.Title}: {fileName}", said, project.Id, cancellationToken);
        return Results.Ok(new { summary, registered = requirements.Registered });
    }
}
