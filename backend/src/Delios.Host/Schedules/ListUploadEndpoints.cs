using System.Security.Cryptography;
using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Records;
using Delios.Host.Tenancy;
using NodaTime;

namespace Delios.Host.Schedules;

/// <summary>A schedule list uploaded on its own: which list, the file, and the uploader's word that they know it is not a register document.</summary>
public sealed record ListUploadRequest(string Kind, string FileName, string ContentBase64, bool Aware, string? Reason);

/// <summary>
/// The schedule's three lists — the schedule, the disciplines per action, the document requirements — are normally
/// documents in the register, put in force by releasing them. Where a project has no such document, Document Control
/// may upload a list on its own: it is read the same way and applied at once, all or nothing. The person says they
/// know it is not a controlled document and why it is uploaded this way; that, the file's fingerprint and its
/// rows are kept among the uploaded lists and in the audit trail, as the proof the register would otherwise hold.
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
        if (!access.IsInternal || !access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control uploads the schedule's lists.");
        if (!Lists.TryGetValue(request.Kind ?? "", out var list)) return Problems.Invalid("LIST_UNKNOWN", "Choose the schedule, the disciplines per action or the document requirements.");
        if (!request.Aware) return Problems.Invalid("NOT_AWARE", "Tick that you know this list is not a document in the register.");
        var reason = request.Reason?.Trim() ?? "";
        if (reason.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why it is uploaded without a register document: it is kept with the upload.");
        byte[] bytes;
        try { bytes = Convert.FromBase64String(request.ContentBase64 ?? ""); }
        catch (FormatException) { return Problems.Invalid("FILE_UNREADABLE", "The file did not arrive whole. Try again."); }
        if (bytes.Length == 0) return Problems.Invalid("FILE_EMPTY", "The file is empty.");
        if (bytes.Length > MaxBytes) return Problems.Invalid("FILE_TOO_LARGE", "The file is larger than 20 MB.");
        var fileName = Path.GetFileName(request.FileName ?? "list.csv");
        if (!ScheduleReader.CanRead(fileName)) return Problems.Invalid("FILE_TYPE", "Upload the list as .xlsx or .csv.");

        var project = access.Project;
        string? summary;
        IReadOnlyList<string> problems;
        switch (list.Kind)
        {
            case "SCHEDULE":
                var (read, error) = await schedules.ReadUploadAsync(project.TenantId, project.Id, fileName, bytes, cancellationToken);
                (summary, problems) = (read, error is null ? [] : [error]);
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
        db.Add(new ControlledVersion
        {
            TenantId = project.TenantId,
            ProjectId = project.Id,
            Kind = list.Kind,
            Key = "default",
            Title = list.Title,
            VersionLabel = "upload",
            State = "APPROVED",
            Payload = JsonSerializer.Serialize(rows),
            RowCount = Math.Max(rows.Count - 1, 0),
            SourceName = fileName,
            SourceSize = bytes.Length,
            SourceHash = Convert.ToHexStringLower(SHA256.HashData(bytes)),
            Notes = summary,
            CreatedById = access.UserId,
            CreatedByName = access.UserName,
            CreatedAt = now,
            DecidedByName = access.UserName,
            DecidedAt = now,
            DecisionReason = reason.Length > 2000 ? reason[..2000] : reason,
            AppliedAt = now,
            AppliedSummary = summary,
        });
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "LIST_UPLOADED_WITHOUT_DOCUMENT", "Project", project.Id, $"{list.Title}: {fileName}",
            $"{list.Title} uploaded without a register document. {access.UserName} confirmed they know it is not a controlled document. Why: {reason} {summary}",
            project.Id, cancellationToken);
        return Results.Ok(new { summary });
    }
}
