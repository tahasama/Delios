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

namespace Delios.Host.Actions;

/// <summary>
/// A schedule list's file uploaded on Schedule &amp; actions: which list, the file, and either the released revision
/// it is the list of, or the uploader's word that there is no such document.
/// </summary>
/// <c>From</c> instead of a file: read again what the other source holds (owner: "make the system take one over the
/// other"): DOCUMENT, the released revision of the list's register document; UPLOAD, the file last uploaded here.
public sealed record ListUploadRequest(string Kind, string? FileName = null, string? ContentBase64 = null, Guid? RevisionId = null, bool Aware = false,
    string? Reason = null, bool Confirmed = false, string? P6Project = null, string? From = null);

/// <summary>What a list would change, line by line: an action, or a discipline's need, before and after.</summary>
public sealed record ListChangeLine(string Key, string Outcome, string Title, IReadOnlyList<Documents.ImportChange> Changes);

/// <summary>A list checked: what it would change, what is wrong with it, and its one-line summary; nothing written.</summary>
public sealed record ListCheckView(string Kind, string Title, string? Source, IReadOnlyList<ListChangeLine> Lines, IReadOnlyList<string> Problems, string? Summary,
    int New, int Updates, int Removed, int Same, ListSheetView? Sheet = null);

/// <summary>
/// The disciplines or requirements list as its file reads (owner: ours, not the planner's word, so corrected line by line):
/// every row of the file, the row its headings are on, and each row under them with what it does and what is wrong.
/// </summary>
public sealed record ListSheetView(string[][] Cells, int HeaderAt, string[] Headings, IReadOnlyList<ListRowView> Rows, int[]? Inherited = null);
/// <summary>One row of the file: its line, what it does (NEW, UPDATE, SAME, PROBLEM, or PENDING while others have problems), and why.</summary>
public sealed record ListRowView(int Line, string Outcome, string Title, IReadOnlyList<Documents.ImportChange> Changes, IReadOnlyList<string> Problems);

/// <summary>
/// The schedule's three lists — the schedule, the disciplines per action, the document requirements — are documents
/// in the register; their revisions are made, reviewed and released there, never here. Here the control function uploads
/// the spreadsheet of the revision in force: it is read and applied at once, all or nothing, and recorded against that
/// revision. The uploader confirms the file is that revision's list as released, taking responsibility for it
/// matching, or says why it differs. Where a project has no such
/// document, a list may be uploaded on its own, with the uploader's word that they know it is not a register
/// document and why. Every upload keeps the uploader, the file's fingerprint and its rows among the uploaded lists and
/// in the audit trail.
/// </summary>
public static class ListUploadEndpoints
{

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
            .MapGet("/schedule/lists/{kind}/source", SourceAsync);
        app.MapGroup("/api/projects/{projectId:guid}").WithTags("Schedule")
            .AddEndpointFilter<ProjectAccessFilter>()
            .MapGet("/schedule/lists/{kind}/source/file", SourceFileAsync).RequireRateLimiting("heavy");
        // Checked first (owner: every import shows what it would do before anything is written): read in a transaction
        // that is always undone, what the project holds compared before and after.
        app.MapGroup("/api/projects/{projectId:guid}").WithTags("Schedule")
            .AddEndpointFilter<ProjectAccessFilter>()
            .MapPost("/schedule/lists/check", CheckAsync)
            .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(140_000_000));
        app.MapGroup("/api/projects/{projectId:guid}").WithTags("Schedule")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>()
            .MapPost("/schedule/lists", UploadAsync)
            // A P6 export is sent whole (kept as it came): up to the screens' 100 MB, in base64.
            .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(140_000_000));
    }

    /// <summary>
    /// The file a list in force was read from, whichever came last (owner): a released revision's file of the register
    /// document (its <c>fileId</c>, opened as any file), or a file uploaded here (served as it came). Our people only.
    /// </summary>
    private static async Task<IResult> SourceAsync(string kind, HttpContext http, DeliosDbContext db, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal || !Lists.ContainsKey(kind)) return Results.NotFound();
        var read = await LatestAsync(db, access.Project.Id, kind, cancellationToken);
        return read is null ? Results.NotFound() : Results.Ok(new { read.Value.Name, read.Value.FileId, uploaded = read.Value.ObjectKey is not null });
    }

    private static async Task<IResult> SourceFileAsync(string kind, HttpContext http, DeliosDbContext db, Documents.FileStorage storage, AuditLog audit,
        Notifications.Notifier notifier, NodaTime.IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal || !Lists.ContainsKey(kind)) return Results.NotFound();
        var read = await LatestAsync(db, access.Project.Id, kind, cancellationToken);
        if (read?.ObjectKey is not { } key) return Results.NotFound();
        await audit.WriteAsync(http.User.Actor(), "DOWNLOAD", "Project", access.Project.Id, read.Value.Name,
            $"{Lists[kind].Title}: the file uploaded, as it came.", access.Project.Id, cancellationToken);
        await DownloadWatch.CountAsync(db, audit, notifier, clock, http.User.Actor(), access.Project.Id, cancellationToken);
        var content = await storage.OpenReadAsync(key, cancellationToken);
        return Results.File(content, ContentTypeOf(read.Value.Name), read.Value.Name);
    }

    /// <summary>The latest read of a list that stands: an upload kept here, or a released revision's file.</summary>
    private static async Task<(string Name, Guid? FileId, string? ObjectKey)?> LatestAsync(DeliosDbContext db, Guid projectId, string kind,
        CancellationToken cancellationToken)
    {
        var listKind = Lists[kind].Kind;
        var versions = await db.Set<ControlledVersion>().AsNoTracking()
            .Where(v => v.ProjectId == projectId && v.Kind == listKind && v.State == "APPROVED")
            .OrderByDescending(v => v.CreatedAt).Select(v => new { v.CreatedAt, v.ObjectKey, v.FileId, v.SourceName }).FirstOrDefaultAsync(cancellationToken);
        var candidates = new List<(Instant At, string? ObjectKey, Guid? FileId)>();
        if (versions is not null)
        {
            var fileId = versions.FileId;
            // A read kept before its file was named ("<number> rev <value>"): that released revision's spreadsheet.
            if (versions.ObjectKey is null && fileId is null && versions.SourceName is { } label && label.LastIndexOf(" rev ", StringComparison.Ordinal) is var cut and > 0)
            {
                var number = label[..cut];
                var value = label[(cut + 5)..];
                var files = await (from d in db.Documents.AsNoTracking()
                                   join r in db.Revisions.AsNoTracking() on d.Id equals r.DocumentId
                                   join f in db.StoredFiles.AsNoTracking() on r.Id equals f.RevisionId
                                   where d.ProjectId == projectId && d.Number == number && r.Value == value && f.Submission == r.Submission
                                   orderby f.CreatedAt descending
                                   select new { f.Id, f.Name }).ToListAsync(cancellationToken);
                fileId = files.FirstOrDefault(f => ScheduleReader.CanRead(f.Name))?.Id;
            }
            if (versions.ObjectKey is not null || fileId is not null) candidates.Add((versions.CreatedAt, versions.ObjectKey, fileId));
        }
        if (listKind == "SCHEDULE")
        {
            var import = await db.ScheduleImports.AsNoTracking()
                .Where(i => i.ProjectId == projectId && i.Status == ScheduleImportStatuses.Done && i.FileId != null)
                .OrderByDescending(i => i.ImportedAt).Select(i => new { i.ImportedAt, i.FileId }).FirstOrDefaultAsync(cancellationToken);
            if (import is not null) candidates.Add((import.ImportedAt, null, import.FileId));
        }
        if (candidates.Count == 0) return null;
        var latest = candidates.MaxBy(c => c.At);
        if (latest.ObjectKey is { } key) return (Path.GetFileName(key), null, key);
        var name = await db.StoredFiles.AsNoTracking().Where(f => f.Id == latest.FileId).Select(f => f.Name).SingleOrDefaultAsync(cancellationToken);
        return name is null ? null : (name, latest.FileId, null);
    }

    /// <summary>What a list's file is, as it is served back.</summary>
    internal static string ContentTypeOf(string fileName) => Path.GetExtension(fileName).ToLowerInvariant() switch
    {
        ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".csv" => "text/csv",
        _ => "application/octet-stream",
    };

    /// <summary>A list ready to be read: which, of which released revision (if any), the file and why.</summary>
    private sealed record Prepared((string Kind, string Title) List, Revision? Revision, string? Label, string FileName, byte[] Bytes, string Reason,
        Guid? FileId, string? From);

    /// <summary>
    /// Who may, which list, and the file: one sent (vouched for, or with why), or the other source read again (owner: the
    /// control function or whoever holds Manage make the system take one over the other, always with why).
    /// </summary>
    private static async Task<(Prepared? Ready, IResult? Problem)> PrepareAsync(ListUploadRequest request, ProjectAccess access, DeliosDbContext db,
        Documents.IVirusScanner scanner, Documents.FileStorage storage, CancellationToken cancellationToken)
    {
        var switching = request.From is not null;
        if (!access.IsInternal || (switching ? !(access.Holds(Verbs.Control) || access.Holds(Verbs.Manage)) : !(access.Holds(Verbs.Control) || access.Holds(Verbs.Plan))))
            return (null, switching
                ? Problems.Forbidden("CONTROL_OR_MANAGE", "The control function, or whoever holds Manage, makes a list read from its other source.")
                : Problems.Forbidden("PLAN_NOT_ALLOWED", "Your function does not upload the schedule's lists. The control function, or a function given Plan, does."));
        if (!Lists.TryGetValue(request.Kind ?? "", out var list)) return (null, Problems.Invalid("LIST_UNKNOWN", "Choose the schedule, the disciplines per action or the document requirements."));
        var project = access.Project;
        var reason = request.Reason?.Trim() ?? "";
        // A reason is kept whole, never cut: one too long is refused, not shortened.
        if (reason.Length > 2000) return (null, Problems.Invalid("REASON_TOO_LONG", "Keep the reason under 2000 characters."));

        if (switching)
        {
            if (reason.Length == 0) return (null, Problems.Invalid("REASON_REQUIRED", "Say why the list is read from its other source: it is kept with the read."));
            if (request.From == "DOCUMENT")
            {
                var documentId = await ListSources.ChosenAsync(db, project.Id, list.Kind, cancellationToken)
                    ?? (list.Kind == "SCHEDULE" ? await db.ScheduleSources.AsNoTracking().Where(s => s.ProjectId == project.Id).Select(s => (Guid?)s.DocumentId).SingleOrDefaultAsync(cancellationToken) : null);
                if (documentId is null) return (null, Problems.Conflict("NO_DOCUMENT_CHOSEN", $"No register document is chosen for the {list.Title.ToLowerInvariant()} yet: choose it first."));
                var released = await db.Revisions.AsNoTracking().Include(r => r.Files).Where(r => r.DocumentId == documentId && r.State == RevisionStates.Released)
                    .OrderByDescending(r => r.ReleasedAt).FirstOrDefaultAsync(cancellationToken);
                if (released is null) return (null, Problems.Conflict("NOT_RELEASED", "Its register document has no released revision to read."));
                var number = await db.Documents.AsNoTracking().Where(d => d.Id == documentId).Select(d => d.Number).SingleAsync(cancellationToken);
                // The file its release reads: for the schedule a P6 export first, then Excel, then CSV; for the others Excel, then CSV.
                var file = released.Files.Where(f => f.Submission == released.Submission && f.Status == Documents.FileStatuses.Clean
                        && (list.Kind == "SCHEDULE" ? ScheduleReader.CanReadSchedule(f.Name) : ScheduleReader.CanRead(f.Name)))
                    .OrderBy(f => XerReader.IsXer(f.Name) ? 0 : f.Name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) ? 1 : 2).FirstOrDefault();
                if (file is null) return (null, Problems.Conflict("NO_LIST_FILE", $"{number} rev {released.Value} carries no spreadsheet to read the list from."));
                using var copy = new MemoryStream();
                await using (var stream = await storage.OpenReadAsync(file.ObjectKey, cancellationToken)) await stream.CopyToAsync(copy, cancellationToken);
                return (new Prepared(list, released, $"{number} rev {released.Value}", file.Name, copy.ToArray(), reason, file.Id, "DOCUMENT"), null);
            }
            if (request.From == "UPLOAD")
            {
                var kept = await db.Set<ControlledVersion>().AsNoTracking()
                    .Where(v => v.ProjectId == project.Id && v.Kind == list.Kind && v.State == "APPROVED" && v.ObjectKey != null)
                    .OrderByDescending(v => v.CreatedAt).FirstOrDefaultAsync(cancellationToken);
                if (kept?.ObjectKey is not { } key) return (null, Problems.Conflict("NO_UPLOAD", $"No file was uploaded for the {list.Title.ToLowerInvariant()} yet."));
                using var copy = new MemoryStream();
                await using (var stream = await storage.OpenReadAsync(key, cancellationToken)) await stream.CopyToAsync(copy, cancellationToken);
                return (new Prepared(list, null, null, Path.GetFileName(key), copy.ToArray(), reason, null, "UPLOAD"), null);
            }
            return (null, Problems.Invalid("FROM_UNKNOWN", "A list is read again from its register document or from the file last uploaded."));
        }

        // The released revision the file is the list of, or none, knowingly.
        Revision? revision = null;
        string? label = null;
        if (request.RevisionId is { } revisionId)
        {
            revision = await db.Revisions.AsNoTracking().SingleOrDefaultAsync(r => r.Id == revisionId && r.ProjectId == project.Id, cancellationToken);
            if (revision is null) return (null, Problems.NotFound("REVISION_NOT_FOUND", "No such revision."));
            if (revision.State != RevisionStates.Released)
                return (null, Problems.Conflict("REVISION_NOT_RELEASED", $"Rev {revision.Value} is not the released revision. Upload the list of the released revision."));
            var document = await db.Documents.AsNoTracking().SingleAsync(d => d.Id == revision.DocumentId, cancellationToken);
            label = $"{document.Number} rev {revision.Value}";
            var source = await db.ScheduleSources.AsNoTracking().SingleOrDefaultAsync(s => s.ProjectId == project.Id, cancellationToken);
            var fits = list.Kind switch
            {
                "SCHEDULE" => source is null ? document.DocType == "SCH" : source.DocumentId == document.Id,
                DepartmentsImporter.Kind => await DepartmentsImporter.IsListAsync(db, document.Id, cancellationToken),
                _ => await RequirementsImporter.IsListAsync(db, document.Id, cancellationToken),
            };
            if (!fits) return (null, Problems.Invalid("NOT_THIS_LIST", $"{document.Number} does not hold the {list.Title.ToLowerInvariant()}."));
            // The uploader vouches for the file, or says why it is not the released revision's list as it stands.
            if (!request.Confirmed && reason.Length == 0)
                return (null, Problems.Invalid("CONFIRM_OR_REASON", $"Tick that this file is the list of {label} as released, or say why it differs."));
        }
        else
        {
            if (reason.Length == 0) return (null, Problems.Invalid("REASON_REQUIRED", "Say why it is uploaded without a register document: it is kept with the upload."));
        }

        byte[] bytes;
        try { bytes = Convert.FromBase64String(request.ContentBase64 ?? ""); }
        catch (FormatException) { return (null, Problems.Invalid("FILE_UNREADABLE", "The file did not arrive whole. Try again.")); }
        var fileName = Path.GetFileName(request.FileName ?? "list.csv");
        // What it really is, its size unpacked, macros and viruses, before anything reads it.
        if (await Documents.SheetGuard.RefusalAsync(fileName, bytes, scanner, cancellationToken) is { } refused) return (null, refused);
        return (new Prepared(list, revision, label, fileName, bytes, reason, null, null), null);
    }

    /// <summary>Reads the list into the project (in the caller's transaction): what changed, or why it cannot be read.</summary>
    private static async Task<(string? Summary, IReadOnlyList<string> Problems)> ReadAsync(Prepared ready, Project project, string? p6Project,
        ScheduleImporter schedules, DepartmentsImporter departments, RequirementsImporter requirements, CancellationToken cancellationToken)
    {
        switch (ready.List.Kind)
        {
            case "SCHEDULE":
                var (applied, error) = await schedules.ReadUploadAsync(project.TenantId, project.Id, ready.FileName, ready.Bytes, ready.Revision, cancellationToken, p6Project);
                return (applied, error is null ? [] : [error]);
            case DepartmentsImporter.Kind:
                var (summary, tagged) = await departments.ReadUploadAsync(project, ready.FileName, ready.Bytes, cancellationToken);
                return (summary, tagged);
            default:
                return await requirements.ReadUploadAsync(project, ready.FileName, ready.Bytes, cancellationToken);
        }
    }

    /// <summary>
    /// POST <c>/schedule/lists/check</c>: the list read exactly as applying it would, in a transaction that is always
    /// undone, and what the project holds compared before and after: each action new, changed (field "was → now") or
    /// removed, each discipline's need added, changed or dropped, and why the file cannot be read. Nothing is kept.
    /// </summary>
    private static async Task<IResult> CheckAsync(ListUploadRequest request, HttpContext http, DeliosDbContext db, Documents.IVirusScanner scanner,
        ScheduleImporter schedules, Documents.FileStorage storage, DepartmentsImporter departments, RequirementsImporter requirements, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            var (ready, problem) = await PrepareAsync(request, access, db, scanner, storage, cancellationToken);
            if (problem is not null) return problem;
            var before = await SnapshotAsync(db, access.Project.Id, ready!.List.Kind, cancellationToken);
            var p6 = string.IsNullOrWhiteSpace(request.P6Project) ? null : request.P6Project.Trim();
            var (summary, problems) = await ReadAsync(ready, access.Project, p6, schedules, departments, requirements, cancellationToken);
            var after = problems.Count > 0 ? before : await SnapshotAsync(db, access.Project.Id, ready.List.Kind, cancellationToken);
            var lines = Compare(before, after);
            var sheet = ready.List.Kind == "SCHEDULE" ? null : await SheetAsync(db, access.Project.Id, ready, lines, problems, cancellationToken);
            // A file with problems reads nothing: its other rows wait on them, never "no change".
            var listProblems = sheet is null ? problems : problems.Where(p => !LineOf(p).HasValue).ToList();
            return Results.Ok(new ListCheckView(ready.List.Kind, ready.List.Title, ready.Label ?? ready.FileName, lines, listProblems, summary,
                lines.Count(l => l.Outcome == "NEW"), lines.Count(l => l.Outcome == "UPDATE"), lines.Count(l => l.Outcome == "REMOVED"), lines.Count(l => l.Outcome == "SAME"), sheet));
        }
        finally
        {
            // A check never writes: whatever the read did is undone.
            await transaction.RollbackAsync(CancellationToken.None);
            db.ChangeTracker.Clear();
        }
    }

    /// <summary>The line a problem names ("Line 12: …"), as the importers write them.</summary>
    private static int? LineOf(string problem)
    {
        if (!problem.StartsWith("Line ", StringComparison.Ordinal)) return null;
        var colon = problem.IndexOf(':', 5);
        return colon > 5 && int.TryParse(problem[5..colon], out var line) ? line : null;
    }

    /// <summary>
    /// Every row of a disciplines or requirements file with what it does: its problems (by the line the reading names), else
    /// the change it makes to the action or need it names (read from the comparison before and after), so each row can be
    /// corrected or taken off before the list is applied.
    /// </summary>
    private static async Task<ListSheetView?> SheetAsync(DeliosDbContext db, Guid projectId, Prepared ready, List<ListChangeLine> lines, IReadOnlyList<string> problems,
        CancellationToken cancellationToken)
    {
        List<string[]> rows;
        try { using var content = new MemoryStream(ready.Bytes); rows = ScheduleReader.ReadRows(content, ready.FileName); }
        catch (Exception e) when (e is not OperationCanceledException) { return null; }
        static string Norm(string text) => text.Trim().ToLowerInvariant();
        var requirements = ready.List.Kind == RequirementsImporter.Kind;
        var header = -1;
        var at = new Dictionary<string, int>();
        for (var r = 0; r < Math.Min(10, rows.Count) && header < 0; r++)
        {
            var headings = rows[r].Select(Norm).ToArray();
            int Find(IEnumerable<string> names) => names.Select(n => Array.IndexOf(headings, n)).FirstOrDefault(i => i >= 0, -1);
            if (requirements)
            {
                var found = RequirementsImporter.Columns.ToDictionary(c => c.Key, c => Find(c.Value));
                if (found["action"] >= 0 && found["document"] >= 0 && found["department"] >= 0) { header = r; at = found; }
            }
            else
            {
                var action = Find(DepartmentsImporter.ActionHeadings);
                var departments = Find(DepartmentsImporter.DepartmentHeadings);
                if (action >= 0 && departments >= 0) { header = r; at = new() { ["action"] = action, ["departments"] = departments }; }
            }
        }
        var width = rows.Count == 0 ? 0 : rows.Max(r => r.Length);
        var cells = rows.Select(r => r.Concat(Enumerable.Repeat("", width - r.Length)).ToArray()).ToArray();
        if (header < 0) return new ListSheetView(cells, -1, [], []);
        var activities = await db.Activities.AsNoTracking().Where(a => a.ProjectId == projectId && a.State != ActivityStates.Removed).ToListAsync(cancellationToken);
        var byKey = lines.ToDictionary(l => l.Key);
        var wrong = problems.Select(p => (Line: LineOf(p), Text: p)).Where(p => p.Line.HasValue).GroupBy(p => p.Line!.Value)
            .ToDictionary(g => g.Key, g => g.Select(p => p.Text[(p.Text.IndexOf(':') + 1)..].Trim()).ToList());
        var anyWrong = problems.Count > 0;
        var result = new List<ListRowView>();
        string lastAction = "", lastDepartment = "";
        for (var r = header + 1; r < cells.Length; r++)
        {
            if (cells[r].All(string.IsNullOrWhiteSpace)) continue;
            var line = r + 1;
            string Cell(string column) => at.TryGetValue(column, out var i) && i >= 0 && i < cells[r].Length ? cells[r][i].Trim() : "";
            string key, title;
            if (requirements)
            {
                var action = Cell("action").ToUpperInvariant() is { Length: > 0 } a ? a : lastAction;
                var department = (Cell("department").ToUpperInvariant() is { Length: > 0 } d ? d : lastDepartment).Split(',')[0].Trim();
                if (action.Length > 0) lastAction = action;
                if (department.Length > 0) lastDepartment = department;
                var document = Cell("document");
                var code = ScheduleImporter.Named(activities, action)?.Code ?? action;
                key = $"{code} · {document} · {department}";
                title = $"{code} — {(document.Length > 0 ? document : "nothing more needed")}{(department.Length > 0 ? $" ({department})" : "")}";
                if (document.Length == 0) { result.Add(new(line, "SAME", title, [], [])); continue; }
            }
            else
            {
                var given = Cell("action");
                var found = ScheduleImporter.Named(activities, given);
                key = found?.Code ?? given;
                title = found is null ? given : $"{found.Code}{(found.ExternalId is null ? "" : $" ({found.ExternalId})")} {found.Name}";
            }
            if (wrong.TryGetValue(line, out var said)) { result.Add(new(line, "PROBLEM", title, [], said)); continue; }
            if (anyWrong) { result.Add(new(line, "PENDING", title, [], [])); continue; }
            if (byKey.TryGetValue(key, out var change)) result.Add(new(line, change.Outcome, change.Title, change.Changes, []));
            else result.Add(new(line, requirements ? "NEW" : "SAME", title, [], []));
        }
        // The requirements' rows inherit their action and department from the row above: a row taken off must not move them.
        int[] inherited = requirements ? [at["action"], at["department"]] : [];
        return new ListSheetView(cells, header, cells[header], result, inherited);
    }

    /// <summary>What a list's reading touches, by line: each action (the schedule, its disciplines) or each need (the requirements).</summary>
    private static async Task<Dictionary<string, (string Title, Dictionary<string, string?> Fields)>> SnapshotAsync(DeliosDbContext db, Guid projectId, string kind,
        CancellationToken cancellationToken)
    {
        if (kind == RequirementsImporter.Kind)
        {
            var needs = await (from n in db.Requirements.AsNoTracking()
                               join a in db.Activities.AsNoTracking() on n.ActivityId equals a.Id
                               join d in db.Documents.AsNoTracking() on n.DocumentId equals d.Id
                               where n.ProjectId == projectId
                               select new { Action = a.Code, ActionName = a.Name, d.Number, d.Title, n.Department, n.RequiredStatuses, n.FixedDate, n.RiskDays })
                .ToListAsync(cancellationToken);
            return needs.GroupBy(n => $"{n.Action} · {n.Number} · {n.Department}").ToDictionary(g => g.Key, g =>
            {
                var n = g.First();
                return ($"{n.Action} {n.ActionName} — {n.Number} {n.Title}" + (n.Department is null ? "" : $" ({n.Department})"),
                    new Dictionary<string, string?> { ["Status"] = string.Join(", ", n.RequiredStatuses), ["Needed by"] = n.FixedDate?.ToString(), ["Risk window (days)"] = n.RiskDays?.ToString() });
            });
        }
        var actions = await db.Activities.AsNoTracking().Where(a => a.ProjectId == projectId && a.State != ActivityStates.Removed)
            .Select(a => new { a.Code, a.ExternalId, a.Name, a.Start, a.Finish, a.Departments }).ToListAsync(cancellationToken);
        return actions.ToDictionary(a => a.Code, a => ($"{a.Code}{(a.ExternalId is null ? "" : $" ({a.ExternalId})")} {a.Name}",
            kind == DepartmentsImporter.Kind
                ? new Dictionary<string, string?> { ["Disciplines"] = string.Join(", ", a.Departments.Order()) }
                : new Dictionary<string, string?> { ["Name"] = a.Name, ["Start"] = a.Start?.ToString(), ["Finish"] = a.Finish?.ToString(), ["Disciplines"] = string.Join(", ", a.Departments.Order()) }));
    }

    /// <summary>Each line as it stood and as it would stand: new, changed (each field "was → now"), removed, or the same.</summary>
    private static List<ListChangeLine> Compare(Dictionary<string, (string Title, Dictionary<string, string?> Fields)> before,
        Dictionary<string, (string Title, Dictionary<string, string?> Fields)> after)
    {
        var lines = new List<ListChangeLine>();
        foreach (var (key, now) in after)
        {
            if (!before.TryGetValue(key, out var was)) { lines.Add(new(key, "NEW", now.Title, now.Fields.Where(f => !string.IsNullOrEmpty(f.Value)).Select(f => new Documents.ImportChange(f.Key, null, f.Value)).ToList())); continue; }
            var changes = now.Fields.Where(f => was.Fields.GetValueOrDefault(f.Key) != f.Value).Select(f => new Documents.ImportChange(f.Key, was.Fields.GetValueOrDefault(f.Key), f.Value)).ToList();
            lines.Add(new(key, changes.Count > 0 ? "UPDATE" : "SAME", now.Title, changes));
        }
        foreach (var (key, was) in before.Where(b => !after.ContainsKey(b.Key))) lines.Add(new(key, "REMOVED", was.Title, []));
        return [.. lines.OrderBy(l => l.Outcome switch { "NEW" => 0, "UPDATE" => 1, "REMOVED" => 2, _ => 3 }).ThenBy(l => l.Key, StringComparer.Ordinal)];
    }

    private static async Task<IResult> UploadAsync(
        ListUploadRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock, Documents.IVirusScanner scanner,
        ScheduleImporter schedules, Documents.FileStorage storage, DepartmentsImporter departments, RequirementsImporter requirements, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (ready, prepared) = await PrepareAsync(request, access, db, scanner, storage, cancellationToken);
        if (prepared is not null) return prepared;
        var project = access.Project;
        var list = ready!.List;
        var revision = ready.Revision;
        var label = ready.Label;
        var fileName = ready.FileName;
        var bytes = ready.Bytes;
        var reason = ready.Reason;
        // The first schedule upload of a revision names the project's schedule document.
        if (list.Kind == "SCHEDULE" && revision is not null && !await db.ScheduleSources.AnyAsync(s => s.ProjectId == project.Id, cancellationToken))
            db.ScheduleSources.Add(new ScheduleSource { TenantId = project.TenantId, ProjectId = project.Id, DocumentId = revision.DocumentId });
        await db.SaveChangesAsync(cancellationToken);

        var (summary, problems) = await ReadAsync(ready, project, string.IsNullOrWhiteSpace(request.P6Project) ? null : request.P6Project.Trim(),
            schedules, departments, requirements, cancellationToken);
        if (problems.Count > 0)
        {
            // Nothing is applied: the transaction is dropped with the refusal.
            var shown = string.Join(" ", problems.Take(5)) + (problems.Count > 5 ? $" … and {problems.Count - 5} more." : "");
            return Problems.Invalid("LIST_NOT_READ", $"Nothing was applied. {shown}", new { problems });
        }

        List<string[]> rows;
        // A P6 export holding several projects is read for ours, by its code.
        var named = XerReader.IsXer(fileName)
            ? (string.IsNullOrWhiteSpace(request.P6Project) ? null : request.P6Project.Trim())
                ?? (await db.ScheduleSources.AsNoTracking().SingleOrDefaultAsync(s => s.ProjectId == project.Id, cancellationToken))?.Columns.Sheet ?? project.Code
            : null;
        using (var content = new MemoryStream(bytes)) rows = ScheduleReader.ReadRows(content, fileName, named);
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
        // The file read is kept exactly as it came, to be downloaded as it is.
        var kept = new ControlledVersion
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
            DecisionReason = reason.Length == 0 ? null : reason,
            AppliedAt = now,
            AppliedSummary = note,
        };
        if (ready.FileId is { } fromDocument) kept.FileId = fromDocument; // read again from its register document: that file, not a copy
        else
        {
            kept.ObjectKey = $"lists/{project.Id}/{kept.Id}/{fileName}";
            await storage.PutAsync(kept.ObjectKey, bytes, ContentTypeOf(fileName), cancellationToken);
        }
        db.Add(kept);
        await db.SaveChangesAsync(cancellationToken);
        if (ready.From is { } from)
        {
            var switched = from == "DOCUMENT" ? $"{list.Title} read again from its register document, {label}." : $"{list.Title} read again from the file last uploaded, {fileName}.";
            await audit.WriteAsync(http.User.Actor(), "LIST_SOURCE_SWITCHED", revision is null ? "Project" : "Revision", revision?.Id ?? project.Id,
                label ?? $"{list.Title}: {fileName}", $"{switched} By {access.UserName}. Why: {reason} {summary}", project.Id, cancellationToken);
            return Results.Ok(new { summary, registered = requirements.Registered });
        }
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
