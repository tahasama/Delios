using System.Globalization;
using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Records;
using Delios.Host.Reviews;
using Delios.Host.Tenancy;
using Delios.Host.Transmittals;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Schedules;

/// <summary>Sent through the outbox when a document requirements list is released: the worker reads it.</summary>
public sealed record RequirementsImportRequested(Guid TenantId, Guid RevisionId)
{
    public const string RoutingKey = "needs.import";
}

/// <summary>
/// The document requirements list as a controlled document. A document whose type is marked as a requirements list is
/// reviewed like any other; once a revision is released, the spreadsheet attached to it is read and becomes what each
/// activity needs: one row per document, with its department, required status and, if given, the day it is needed.
/// For every (activity, department) the list mentions, the list is the whole truth: what it no longer lists is no
/// longer needed. A document not in the register is registered as a placeholder. The list is read whole or not at
/// all: if any row is wrong, nothing changes and Document Control is told what to fix.
/// </summary>
public sealed class RequirementsImporter(
    DeliosDbContext db, TenantContext tenant, FileStorage storage, DocumentService documents, AuditLog audit, IClock clock,
    Notifications.Notifier notifier, ILogger<RequirementsImporter> logger)
{
    /// <summary>The numbers of the placeholders the last list read registered, for the reader to go and see.</summary>
    public List<string> Registered { get; } = [];

    /// <summary>The document type property that marks a requirements list.</summary>
    public const string Marker = "readsRequirements";
    /// <summary>How the list is filed among the uploaded lists, so its history reads in one place.</summary>
    public const string Kind = "DOCUMENT_REQUIREMENTS";

    private static readonly Dictionary<string, string[]> Columns = new()
    {
        ["department"] = ["department", "departments"],
        ["action"] = ["action code", "activity code", "activity id"],
        ["document"] = ["document", "document number", "documents", "title"],
        ["discipline"] = ["discipline"],
        ["type"] = ["type", "document type"],
        ["supplier"] = ["supplier", "submitted by"],
        ["date"] = ["date of delivery", "needed by"],
        ["status"] = ["required status"],
        ["approvedBy"] = ["approved by"],
        ["asset"] = ["equipment or material"],
        ["subproject"] = ["sub-project", "subproject"],
        ["po"] = ["po"],
    };

    private static readonly string[] Ours = ["", "OURS", "US", "INTERNAL", "INTERNAL ENGINEERING", "OUR ENGINEERING", "ENG"];

    private sealed record Row(
        int Line, string ActionCode, string Department, string? DocNumber, string? Title, string? Discipline, string? DocType,
        string? Supplier, string Status, LocalDate? NeededBy, string? Subproject, string? Po, string? Asset);

    /// <summary>Whether a released revision is a requirements list, by its document's type.</summary>
    public static async Task<bool> IsListAsync(DeliosDbContext db, Guid documentId, CancellationToken cancellationToken)
    {
        var docType = await db.Documents.AsNoTracking().Where(d => d.Id == documentId).Select(d => d.DocType).SingleOrDefaultAsync(cancellationToken);
        if (docType is null) return false;
        var value = await db.ValueEntries.AsNoTracking().SingleOrDefaultAsync(v => v.SetKey == ValueSets.DocumentTypes && v.Code == docType, cancellationToken);
        return value?.Props?.RootElement.TryGetProperty(Marker, out var p) == true && p.ValueKind == JsonValueKind.True;
    }

    /// <summary>Reads a released requirements list, once per revision.</summary>
    public async Task OnRequestedAsync(RequirementsImportRequested message, CancellationToken cancellationToken)
    {
        tenant.Set(message.TenantId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var revision = await db.Revisions.Include(r => r.Files).SingleOrDefaultAsync(r => r.Id == message.RevisionId, cancellationToken);
        if (revision is null || revision.State != RevisionStates.Released) return;
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({"requirements:" + revision.ProjectId}))", cancellationToken);
        var document = await db.Documents.AsNoTracking().SingleAsync(d => d.Id == revision.DocumentId, cancellationToken);
        var label = $"{document.Number} rev {revision.Value}";
        if (await db.Set<ControlledVersion>().AnyAsync(v => v.ProjectId == revision.ProjectId && v.Kind == Kind && v.SourceName == label, cancellationToken))
            return;
        var project = await db.Projects.AsNoTracking().SingleAsync(p => p.Id == revision.ProjectId, cancellationToken);

        var file = revision.Files.Where(f => f.Status == FileStatuses.Clean && f.Submission == revision.Submission && ScheduleReader.CanRead(f.Name))
            .OrderBy(f => f.Name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) ? 0 : 1).FirstOrDefault();
        IReadOnlyList<string> problems;
        string? summary = null;
        if (file is null)
        {
            problems = ["The released revision has no .xlsx or .csv file to read the list from."];
        }
        else
        {
            List<string[]> rows;
            await using (var content = await storage.OpenReadAsync(file.ObjectKey, cancellationToken))
            {
                try { rows = ScheduleReader.ReadRows(content, file.Name); }
                catch (Exception e) when (e is not OperationCanceledException) { rows = []; logger.LogWarning(e, "Could not read {File}", file.Name); }
            }
            var (parsed, issues) = await ParseAsync(project, rows, cancellationToken);
            problems = issues;
            if (problems.Count == 0)
            {
                var (applied, applyProblems) = await ApplyAsync(project, parsed, label, cancellationToken);
                problems = applyProblems;
                summary = applied;
            }
        }

        if (problems.Count > 0)
        {
            // Nothing the list says is applied: the transaction is dropped, and its failure recorded on its own.
            await transaction.RollbackAsync(cancellationToken);
            await RecordAsync(project, document, revision, file, label, null, problems, cancellationToken);
            return;
        }
        await RecordAsync(project, document, revision, file, label, summary, [], cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    /// <summary>
    /// Reads a list uploaded on its own, with no document in the register: the same reading, applied at once, all
    /// or nothing. Returns what changed, or what is wrong. The caller records who did it and why.
    /// </summary>
    public async Task<(string? Summary, IReadOnlyList<string> Problems)> ReadUploadAsync(Project project, string fileName, byte[] bytes, CancellationToken cancellationToken)
    {
        if (!ScheduleReader.CanRead(fileName)) return (null, ["The list must be an .xlsx or .csv file."]);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({"requirements:" + project.Id}))", cancellationToken);
        List<string[]> rows;
        try { using var content = new MemoryStream(bytes); rows = ScheduleReader.ReadRows(content, fileName); }
        catch (Exception e) when (e is not OperationCanceledException) { return (null, [$"{fileName} could not be read: {e.Message}"]); }
        var (parsed, problems) = await ParseAsync(project, rows, cancellationToken);
        if (problems.Count > 0) return (null, problems);
        return await ApplyAsync(project, parsed, $"{fileName} (uploaded)", cancellationToken);
    }

    /// <summary>The list's history among the uploaded lists, the audit trail, and Document Control told.</summary>
    private async Task RecordAsync(Project project, Document document, Revision revision, StoredFile? file, string label, string? summary,
        IReadOnlyList<string> problems, CancellationToken cancellationToken)
    {
        var failed = problems.Count > 0;
        // A failure is written in a transaction of its own: what the list said was dropped with the one before.
        await using var own = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(cancellationToken) : null;
        db.ChangeTracker.Clear();
        var now = clock.GetCurrentInstant();
        var shown = string.Join("\n", problems.Take(20)) + (problems.Count > 20 ? $"\n… and {problems.Count - 20} more." : "");
        db.Add(new ControlledVersion
        {
            TenantId = project.TenantId,
            ProjectId = project.Id,
            Kind = Kind,
            Key = "default",
            Title = "Document requirements",
            VersionLabel = $"rev {revision.Value}" is { Length: <= 16 } brief ? brief : revision.Value[..Math.Min(16, revision.Value.Length)],
            State = failed ? "REJECTED" : "APPROVED",
            Payload = "[]",
            RowCount = 0,
            SourceName = label,
            SourceSize = file?.Size,
            SourceHash = file?.Sha256,
            Notes = failed ? null : summary,
            CreatedById = revision.AuthoredById,
            CreatedByName = "Released revision",
            CreatedAt = now,
            DecidedByName = "Released revision",
            DecidedAt = now,
            DecisionReason = failed ? shown : null,
        });
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(Actor.System, failed ? "REQUIREMENTS_NOT_READ" : "REQUIREMENTS_READ", "Revision", revision.Id, label,
            failed ? $"The list was not applied: {shown}" : summary, project.Id, cancellationToken);
        await notifier.NotifyAsync(project.TenantId, project.Id, await notifier.ControlHoldersAsync(project.Id, cancellationToken),
            Notifications.NotificationKinds.General,
            failed ? $"{label}: the requirements list was not read" : $"{label}: the requirements list is in force",
            failed ? $"Nothing it says was applied. Fix the list and release a new revision, or upload it under Schedule & actions.\n{shown}" : summary,
            $"/documents/{document.Id}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        if (own is not null) await own.CommitAsync(cancellationToken);
    }

    private static string Normalize(string text) => text.Trim().ToLowerInvariant();

    /// <summary>The rows the list carries, or what is wrong with them, line by line.</summary>
    private async Task<(List<Row> Rows, List<string> Problems)> ParseAsync(Project project, List<string[]> rows, CancellationToken cancellationToken)
    {
        var problems = new List<string>();
        var header = -1;
        var index = new Dictionary<string, int>();
        for (var r = 0; r < Math.Min(10, rows.Count) && header < 0; r++)
        {
            var headings = rows[r].Select(Normalize).ToArray();
            var found = Columns.ToDictionary(c => c.Key, c => c.Value.Select(name => Array.IndexOf(headings, name)).FirstOrDefault(i => i >= 0, -1));
            if (found["action"] >= 0 && found["document"] >= 0 && found["department"] >= 0) { header = r; index = found; }
        }
        if (header < 0)
            return ([], ["No heading row with Department, Action Code and Document was found in the first ten rows. Keep the template's header row."]);

        var activities = await db.Activities.AsNoTracking().Where(a => a.ProjectId == project.Id).ToDictionaryAsync(a => a.Code, cancellationToken);
        var register = await db.Documents.AsNoTracking().Where(d => d.ProjectId == project.Id)
            .Select(d => new { d.Number, d.DocType }).ToDictionaryAsync(d => d.Number, d => d.DocType, cancellationToken);
        var values = await db.ValueEntries.AsNoTracking().Where(v => v.Status == ValueStatus.Active).ToListAsync(cancellationToken);
        bool Has(string set, string? code) => code is not null && values.Any(v => v.SetKey == set && v.Code == code);
        bool Flag(ValueEntry v, string prop) => v.Props?.RootElement.TryGetProperty(prop, out var p) == true && p.ValueKind == JsonValueKind.True;
        var statuses = values.Where(v => v.SetKey == ReviewSets.Statuses).OrderBy(v => v.Sort).ToList();
        var defaultStatus = (statuses.FirstOrDefault(v => Flag(v, "executes") || Flag(v, "executionFlag")) ?? statuses.FirstOrDefault())?.Code;
        var describesAsset = values.Where(v => v.SetKey == ValueSets.DocumentTypes && Flag(v, "describesAsset")).Select(v => v.Code).ToHashSet();
        var parties = await db.Parties.AsNoTracking().Where(p => p.Active && !p.IsInternal).Select(p => p.Code).ToListAsync(cancellationToken);

        var parsed = new List<Row>();
        var seen = new HashSet<string>();
        string lastAction = "", lastDepartment = "";
        for (var r = header + 1; r < rows.Count; r++)
        {
            var line = r + 1;
            string Cell(string column) => index[column] >= 0 && index[column] < rows[r].Length ? rows[r][index[column]].Trim() : "";
            if (rows[r].All(string.IsNullOrWhiteSpace)) continue;
            // A group of lines shares its action and department: written on the first line, inherited below it.
            var actionCode = Cell("action").ToUpperInvariant() is { Length: > 0 } a ? a : lastAction;
            var department = (Cell("department").ToUpperInvariant() is { Length: > 0 } d ? d : lastDepartment).Split(',')[0].Trim();
            if (actionCode.Length > 0) lastAction = actionCode;
            if (department.Length > 0) lastDepartment = department;
            var named = Cell("document");
            // Blank lines under an action mean nothing more is needed there.
            if (named.Length == 0) continue;
            var errors = new List<string>();
            var docNumber = register.ContainsKey(named) ? named : null;
            var title = docNumber is null ? named : null;
            var discipline = Cell("discipline").ToUpperInvariant() is { Length: > 0 } dc ? dc : null;
            var docType = Cell("type").ToUpperInvariant() is { Length: > 0 } t ? t : null;
            var supplier = Cell("supplier").ToUpperInvariant();
            var status = Cell("status").ToUpperInvariant() is { Length: > 0 } s ? s : defaultStatus ?? "";
            var dateText = Cell("date");
            var subproject = Cell("subproject") is { Length: > 0 } sp ? sp : null;
            var po = Cell("po") is { Length: > 0 } p ? p : null;
            var asset = Cell("asset").ToUpperInvariant() is { Length: > 0 } at ? at : null;

            if (actionCode.Length == 0) errors.Add("Action Code is missing");
            else if (!activities.TryGetValue(actionCode, out var activity)) errors.Add($"Action {actionCode} is not in the schedule");
            else if (activity.Departments.Length == 0) errors.Add($"Action {actionCode} has no departments yet");
            else if (!activity.Departments.Contains(department, StringComparer.OrdinalIgnoreCase))
                errors.Add($"{(department.Length > 0 ? department : "(no department)")} is not a department of {actionCode} ({string.Join(", ", activity.Departments)})");
            var external = !Ours.Contains(supplier);
            if (external && !parties.Contains(supplier)) errors.Add($"Supplier \"{supplier}\" is not an organization on this project; leave it empty for our own engineering");
            if (status.Length == 0) errors.Add("No status is published, so nothing can be required");
            else if (!Has(ReviewSets.Statuses, status)) errors.Add($"Required Status \"{status}\" is not a published status");
            LocalDate? neededBy = null;
            if (dateText.Length > 0)
            {
                if (DateTime.TryParseExact(dateText, ["yyyy-MM-dd", "dd/MM/yyyy", "d/M/yyyy"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
                    neededBy = LocalDate.FromDateTime(day);
                else errors.Add("Date of delivery must be YYYY-MM-DD");
            }
            if (discipline is not null && !Has(ValueSets.Disciplines, discipline)) errors.Add($"Discipline \"{discipline}\" is not a published discipline");
            var typeForAsset = docType ?? (docNumber is not null ? register[docNumber] : null);
            if (asset is null && typeForAsset is not null && describesAsset.Contains(typeForAsset))
                errors.Add($"A {typeForAsset} describes equipment: give its tag or material under \"Equipment or material\"");
            if (docNumber is null)
            {
                if (!Has(ValueSets.DocumentTypes, docType)) errors.Add($"\"{named}\" is not in the register, so it is created: give its Type");
                if (discipline is null) errors.Add($"\"{named}\" is created, so give its Discipline");
                if (!Has(ValueSets.Subprojects, subproject)) errors.Add($"\"{named}\" is created and needs a Sub-project for its number");
                if (external && !Has(ValueSets.PurchaseOrders, po)) errors.Add($"\"{named}\" comes from a supplier, so it needs its PO for its number");
            }
            if (!seen.Add($"{actionCode}|{docNumber ?? title}")) errors.Add("This document is listed twice for the same action");
            if (errors.Count > 0) { problems.Add($"Line {line}: {string.Join("; ", errors)}."); continue; }
            parsed.Add(new Row(line, actionCode, department, docNumber, title, discipline, docType, external ? supplier : null, status,
                neededBy, subproject, po, asset));
        }
        if (problems.Count == 0 && parsed.Count == 0) problems.Add("The list has no document on it.");
        return (parsed, problems);
    }

    /// <summary>Makes the list what each activity needs. Returns a summary, or what could not be done.</summary>
    private async Task<(string? Summary, List<string> Problems)> ApplyAsync(Project project, List<Row> rows, string label, CancellationToken cancellationToken)
    {
        var problems = new List<string>();
        var now = clock.GetCurrentInstant();
        var values = await db.ValueEntries.AsNoTracking().Where(v => v.Status == ValueStatus.Active).OrderBy(v => v.Sort).ToListAsync(cancellationToken);
        var reasons = values.Where(v => v.SetKey == TransmittalSets.Reasons).ToList();
        var purpose = (reasons.FirstOrDefault(v => v.Code == "EXECUTION") ?? reasons.FirstOrDefault(v => v.Code == "CONSTRUCTION") ?? reasons.FirstOrDefault())?.Code
            ?? "EXECUTION";
        bool AsksOriginator(ValueEntry v) => v.Props?.RootElement.TryGetProperty("required", out var r) == true && r.ValueKind == JsonValueKind.Array
            && r.EnumerateArray().Any(x => x.GetString() == "originator");
        var deliverables = values.Where(v => v.SetKey == ValueSets.DeliverableTypes).ToList();
        var supplied = deliverables.FirstOrDefault(AsksOriginator)?.Code ?? "SUP";
        var ours = deliverables.Any(v => v.Code == "ENG") ? "ENG" : deliverables.FirstOrDefault(v => !AsksOriginator(v))?.Code ?? "ENG";
        var source = await db.ScheduleSources.AsNoTracking().SingleOrDefaultAsync(s => s.ProjectId == project.Id, cancellationToken);
        var lead = source?.DefaultLeadDays ?? 7;
        var activities = await db.Activities.Where(a => a.ProjectId == project.Id).ToDictionaryAsync(a => a.Code, cancellationToken);
        var register = await db.Documents.AsNoTracking().Where(d => d.ProjectId == project.Id).ToDictionaryAsync(d => d.Number, d => d.Id, cancellationToken);
        var access = await RegistrarAsync(project, cancellationToken);
        int created = 0, kept = 0, changed = 0, dropped = 0;
        var keep = new Dictionary<(Guid Activity, string Department), HashSet<Guid>>();

        foreach (var row in rows)
        {
            var activity = activities[row.ActionCode];
            Guid documentId;
            if (row.DocNumber is not null) documentId = register[row.DocNumber];
            else
            {
                if (access is null) { problems.Add($"Line {row.Line}: nobody on the project may register \"{row.Title}\"."); continue; }
                var (document, problem) = await documents.RegisterAsync(access, new RegisterDocumentRequest(
                    row.Title, row.Supplier is null ? ours : supplied, row.DocType, row.Discipline ?? row.Department, row.Supplier, row.Subproject,
                    row.Po), cancellationToken);
                if (problem is not null) { problems.Add($"Line {row.Line}: \"{row.Title}\" could not be registered: {MessageOf(problem)}"); continue; }
                documentId = document!.Id;
                Registered.Add(document.Number);
                created++;
            }

            if (row.Asset is { } code)
            {
                var asset = await db.Set<Asset>().SingleOrDefaultAsync(a => a.ProjectId == project.Id && a.Code == code, cancellationToken);
                if (asset is null)
                {
                    asset = new Asset { TenantId = project.TenantId, ProjectId = project.Id, Code = code, Name = code };
                    db.Add(asset);
                }
                if (!await db.Set<DocumentAsset>().AnyAsync(l => l.DocumentId == documentId && l.AssetId == asset.Id, cancellationToken))
                    db.Add(new DocumentAsset { TenantId = project.TenantId, ProjectId = project.Id, DocumentId = documentId, AssetId = asset.Id, CreatedByName = label, CreatedAt = now });
            }

            var existing = await db.Requirements.Where(n => n.ActivityId == activity.Id && n.DocumentId == documentId).ToListAsync(cancellationToken);
            var same = existing.FirstOrDefault(n => string.Equals(n.Department, row.Department, StringComparison.OrdinalIgnoreCase)
                && n.RequiredStatuses.SequenceEqual([row.Status]) && n.FixedDate == row.NeededBy);
            if (same is not null) kept++;
            else
            {
                if (existing.Count > 0) { db.Requirements.RemoveRange(existing); changed++; }
                db.Requirements.Add(new Requirement
                {
                    TenantId = project.TenantId,
                    ProjectId = project.Id,
                    ActivityId = activity.Id,
                    DocumentId = documentId,
                    Purpose = purpose,
                    RequiredStatuses = [row.Status],
                    Anchor = Anchors.Start,
                    OffsetDays = -lead,
                    FixedDate = row.NeededBy,
                    Department = row.Department,
                    CreatedByName = label,
                    CreatedAt = now,
                });
            }
            var key = (activity.Id, row.Department.ToUpperInvariant());
            if (!keep.TryGetValue(key, out var listed)) keep[key] = listed = [];
            listed.Add(documentId);
        }
        if (problems.Count > 0) return (null, problems);
        await db.SaveChangesAsync(cancellationToken);

        // What an (activity, department) the list covers no longer lists is no longer needed.
        foreach (var ((activityId, department), listed) in keep)
        {
            var stale = await db.Requirements.Where(n => n.ActivityId == activityId && n.Department != null && n.Department.ToUpper() == department
                && !listed.Contains(n.DocumentId)).ToListAsync(cancellationToken);
            dropped += stale.Count;
            db.Requirements.RemoveRange(stale);
        }
        // The departments whose part the list carries have answered their call.
        var departments = rows.Select(r => r.Department.ToUpperInvariant()).ToHashSet();
        var calls = await db.Set<RequirementCall>().Where(c => c.ProjectId == project.Id && c.AnsweredAt == null).ToListAsync(cancellationToken);
        var answered = 0;
        foreach (var call in calls.Where(c => departments.Contains(c.Department.ToUpperInvariant())))
        {
            call.AnsweredAt = now;
            call.AnswerNote = $"Listed in {label}";
            answered++;
        }
        await db.SaveChangesAsync(cancellationToken);
        await Readiness.RestateAsync(db, clock, keep.Keys.Select(k => k.Activity).Distinct().ToList(), cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        var parts = new List<string> { $"{rows.Count} need(s) in force" };
        if (created > 0) parts.Add($"{created} placeholder(s) registered");
        if (changed > 0) parts.Add($"{changed} changed");
        if (dropped > 0) parts.Add($"{dropped} no longer needed");
        if (answered > 0) parts.Add($"{answered} department call(s) answered");
        return (string.Join(", ", parts) + ".", []);
    }

    /// <summary>Who registers the placeholders the list names: a holder of Document Control on the project.</summary>
    private async Task<ProjectAccess?> RegistrarAsync(Project project, CancellationToken cancellationToken)
    {
        var membership = await db.Memberships.AsNoTracking().Include(m => m.Function!).ThenInclude(f => f.Rules)
            .Where(m => m.ProjectId == project.Id && m.Active && m.Function!.Active && m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Control)))
            .OrderBy(m => m.UserId).FirstOrDefaultAsync(cancellationToken);
        if (membership is null) return null;
        var name = await db.Users.AsNoTracking().Where(u => u.Id == membership.UserId).Select(u => u.Name).SingleAsync(cancellationToken);
        return ProjectAccess.OfFunction(project, membership.Function!, membership.UserId, name);
    }

    private static string MessageOf(IResult problem) =>
        problem is ProblemHttpResult p ? p.ProblemDetails.Title ?? "refused" : "refused";
}
