using System.Globalization;
using System.Text.Json;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Documents;

/// <summary>One line of a deliverable list as read from the file: where it is, the number when it updates a document, and its values by field.</summary>
public sealed record ImportLine(string? At, string? Number, Dictionary<string, string?>? Values);

/// <summary>A deliverable list: the project it was made for (the code the template carries) and its lines.</summary>
public sealed record DeliverableImportRequest(string? Project, List<ImportLine>? Lines);

/// <summary>One field a line would change: what it reads now, what it would read.</summary>
public sealed record ImportChange(string Field, string? Was, string? Now);

/// <summary>What a line would do (or did): NEW, UPDATE, SAME or PROBLEM, with its changes, what is wrong, and the fields at fault.</summary>
public sealed record ImportLineView(string? At, string Outcome, string? Number, Guid? DocumentId, string? Title,
    IReadOnlyList<ImportChange> Changes, IReadOnlyList<string> Problems, IReadOnlyList<string> Fields);

/// <summary>The whole list: each line, the counts, and whether it was written.</summary>
public sealed record DeliverableImportView(IReadOnlyList<ImportLineView> Lines, int New, int Updates, int Same, int Problems, bool Written);

/// <summary>
/// A deliverable list brought in, checked and written by the backend in one call each (it was one call per line from
/// the screens, twice, and its rules lived there). A line with no number registers a new document, numbered as it is
/// registered (owner: numbering is never manual); a line with a number updates that document of this project, never
/// creating one. What the number is built from never changes, and a document's details change only while a revision is
/// prepared (the rule of every change, <see cref="DocumentService.UpdateAsync"/>). A file made for another project is
/// refused whole before a line is read. Writing is all or nothing: the lines the person left in, each checked again.
/// </summary>
public static class DeliverableImport
{
    public static class Outcomes
    {
        public const string New = "NEW";
        public const string Update = "UPDATE";
        public const string Same = "SAME";
        public const string Problem = "PROBLEM";
    }

    private const int MaxLines = 5000;
    /// <summary>What the number is built from: read, never changed by a list.</summary>
    private static readonly string[] InsideTheNumber = ["deliverableType", "docType", "discipline", "subproject", "originator"];
    /// <summary>What a line may change on a document already registered.</summary>
    private static readonly string[] Correctable = ["title", "phase", "contractRef", "criticality", "confidentiality", "retentionClass", "plannedDate", "receivedDate"];

    public static void MapDeliverableImportEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}/imports/deliverables").WithTags("Documents")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>();
        project.MapPost("/check", (DeliverableImportRequest request, HttpContext http, DeliosDbContext db, DocumentService documents,
            CancellationToken cancellationToken) => RunAsync(request, write: false, ProjectAccessFilter.Of(http), db, documents, cancellationToken));
        project.MapPost("/write", (DeliverableImportRequest request, HttpContext http, DeliosDbContext db, DocumentService documents,
            CancellationToken cancellationToken) => RunAsync(request, write: true, ProjectAccessFilter.Of(http), db, documents, cancellationToken));
    }

    private static async Task<IResult> RunAsync(DeliverableImportRequest request, bool write, ProjectAccess access, DeliosDbContext db,
        DocumentService documents, CancellationToken cancellationToken)
    {
        if (!access.IsInternal) return Problems.Forbidden("OURS_ONLY", "A deliverable list is brought in by our own people.");
        var given = request.Project?.Trim();
        if (!string.IsNullOrEmpty(given) && !string.Equals(given, access.Project.Code, StringComparison.OrdinalIgnoreCase))
            return Problems.Invalid("ANOTHER_PROJECT", $"This list was made for {given}; you are in {access.Project.Code}. Open {given} to bring it in, or download this project's template.");
        var lines = request.Lines ?? [];
        if (lines.Count == 0) return Problems.Invalid("NO_LINES", "The file has no filled-in lines.");
        if (lines.Count > MaxLines) return Problems.Invalid("TOO_MANY_LINES", $"A list brings in at most {MaxLines} lines at a time; this one has {lines.Count}.");

        // Every number named, read at once.
        var numbers = lines.Select(l => l.Number?.Trim()).OfType<string>().Where(n => n.Length > 0).Distinct().ToList();
        var known = numbers.Count == 0 ? new Dictionary<string, Document>(StringComparer.Ordinal)
            : await DocumentQueries.Visible(db, access).AsNoTracking().Where(d => d.ProjectId == access.Project.Id && numbers.Contains(d.Number))
                .ToDictionaryAsync(d => d.Number, StringComparer.Ordinal, cancellationToken);
        HashSet<string> named = numbers.Count == 0 ? [] : lines.Select(l => l.Number?.Trim()).Where(n => !string.IsNullOrEmpty(n)).GroupBy(n => n!)
            .Where(g => g.Count() > 1).Select(g => g.Key).ToHashSet(StringComparer.Ordinal);

        var views = new List<ImportLineView>();
        foreach (var line in lines)
        {
            var values = (line.Values ?? []).ToDictionary(v => v.Key, v => Blank(v.Value), StringComparer.Ordinal);
            var number = Blank(line.Number);
            if (number is not null)
            {
                if (named.Contains(number))
                {
                    views.Add(Problem(line, number, null, $"{number} is on more than one line: keep one."));
                    continue;
                }
                if (!known.TryGetValue(number, out var document))
                {
                    views.Add(Problem(line, number, null, $"{number} is not in this project's register. A new document has no number: leave it empty and it is given one when registered."));
                    continue;
                }
                views.Add(await UpdateAsync(line, values, document, write, access, db, documents, cancellationToken));
                continue;
            }
            views.Add(await RegisterAsync(line, values, write, access, db, documents, cancellationToken));
        }

        var problems = views.Count(v => v.Outcome == Outcomes.Problem);
        // Writing is all or nothing: a line that no longer passes undoes the rest (the transaction rolls back).
        if (write && problems > 0)
            return Results.Json(new DeliverableImportView(views, 0, 0, 0, problems, false), statusCode: StatusCodes.Status409Conflict);
        return Results.Ok(new DeliverableImportView(views, views.Count(v => v.Outcome == Outcomes.New), views.Count(v => v.Outcome == Outcomes.Update),
            views.Count(v => v.Outcome == Outcomes.Same), problems, write));
    }

    /// <summary>A line naming a document of the project: what it changes, checked (or written) as changing it by hand would be.</summary>
    private static async Task<ImportLineView> UpdateAsync(ImportLine line, Dictionary<string, string?> values, Document document, bool write,
        ProjectAccess access, DeliosDbContext db, DocumentService documents, CancellationToken cancellationToken)
    {
        // What the number is made of stays: the number would otherwise say one thing and the record another.
        var locked = InsideTheNumber.Where(f => values.GetValueOrDefault(f) is { } v && !string.Equals(v, Current(document, f), StringComparison.Ordinal)).ToList();
        if (locked.Count > 0)
            return Problem(line, document.Number, document, $"{string.Join(", ", locked.Select(Label))} {(locked.Count == 1 ? "is" : "are")} part of the number and cannot change. Withdraw it and register it again under the right number.", locked);
        var changes = new List<ImportChange>();
        var asked = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var field in Correctable.Concat(values.Keys.Where(k => k.StartsWith("extra:", StringComparison.Ordinal))))
        {
            // An empty cell changes nothing.
            if (values.GetValueOrDefault(field) is not { } now) continue;
            var normal = field.EndsWith("Date", StringComparison.Ordinal) && Day(now) is { } day ? day : now;
            var was = Current(document, field);
            if (string.Equals(was, normal, StringComparison.Ordinal)) continue;
            changes.Add(new ImportChange(field, was, normal));
            asked[field] = normal;
        }
        if (changes.Count == 0) return new ImportLineView(line.At, Outcomes.Same, document.Number, document.Id, document.Title, [], [], []);
        var (_, problem) = await documents.UpdateAsync(access, document.Id, new UpdateDocumentRequest(asked), cancellationToken, checkOnly: !write);
        // A check leaves nothing behind it in hand: the next line reads the database as it stands.
        if (!write) db.ChangeTracker.Clear();
        return problem is not null
            ? Problem(line, document.Number, document, MessageOf(problem), FieldsOf(problem, changes.Select(c => c.Field)))
            : new ImportLineView(line.At, Outcomes.Update, document.Number, document.Id, values.GetValueOrDefault("title") ?? document.Title, changes, [], []);
    }

    /// <summary>A line with no number: a new document, checked (or registered) as registering it by hand would be.</summary>
    private static async Task<ImportLineView> RegisterAsync(ImportLine line, Dictionary<string, string?> values, bool write,
        ProjectAccess access, DeliosDbContext db, DocumentService documents, CancellationToken cancellationToken)
    {
        var dates = new List<string>();
        DateOnly? DateOf(string field)
        {
            if (values.GetValueOrDefault(field) is not { } text) return null;
            if (Day(text) is { } day) return DateOnly.ParseExact(day, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            dates.Add(field);
            return null;
        }
        var planned = DateOf("plannedDate");
        var received = DateOf("receivedDate");
        if (dates.Count > 0)
            return Problem(line, null, null, $"{string.Join(", ", dates.Select(Label))}: not a date (write it as YYYY-MM-DD).", dates, values.GetValueOrDefault("title"));
        var extras = values.Where(v => v.Key.StartsWith("extra:", StringComparison.Ordinal) && v.Key.Length > 6).ToDictionary(v => v.Key[6..], v => v.Value);
        var register = new RegisterDocumentRequest(values.GetValueOrDefault("title"), values.GetValueOrDefault("deliverableType"), values.GetValueOrDefault("docType"),
            values.GetValueOrDefault("discipline"), values.GetValueOrDefault("originator"), values.GetValueOrDefault("subproject"), values.GetValueOrDefault("contractRef"),
            values.GetValueOrDefault("criticality"), values.GetValueOrDefault("confidentiality"), values.GetValueOrDefault("retentionClass"), received, planned,
            Extras: extras.Count > 0 ? extras : null, Phase: values.GetValueOrDefault("phase"));
        if (!write)
        {
            var refused = await documents.CheckRegisterAsync(access, register, cancellationToken);
            db.ChangeTracker.Clear();
            return refused is not null
                ? Problem(line, null, null, MessageOf(refused), FieldsOf(refused, []), register.Title)
                : new ImportLineView(line.At, Outcomes.New, null, null, register.Title, [], [], []);
        }
        var (made, problem) = await documents.RegisterAsync(access, register, cancellationToken);
        return problem is not null || made is null
            ? Problem(line, null, null, problem is null ? "refused" : MessageOf(problem), problem is null ? [] : FieldsOf(problem, []), register.Title)
            : new ImportLineView(line.At, Outcomes.New, made.Number, made.Id, made.Title, [], [], []);
    }

    /// <summary>What a document holds in a field, as the list writes it.</summary>
    private static string? Current(Document document, string field) => field switch
    {
        "title" => document.Title,
        "deliverableType" => document.DeliverableType,
        "docType" => document.DocType,
        "discipline" => document.Discipline,
        "subproject" => document.Subproject,
        "originator" => document.Originator,
        "phase" => document.Phase,
        "contractRef" => document.ContractRef,
        "criticality" => document.Criticality,
        "confidentiality" => document.Confidentiality,
        "retentionClass" => document.RetentionClass,
        "plannedDate" => document.PlannedDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        "receivedDate" => document.ReceivedDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        var own when own.StartsWith("extra:", StringComparison.Ordinal) => OwnFields.Read(document.Extras, own[6..]),
        _ => null,
    };

    /// <summary>The words a person reads for a field.</summary>
    private static string Label(string field) => field switch
    {
        "deliverableType" => "Deliverable type",
        "docType" => "Type",
        "discipline" => "Discipline",
        "subproject" => "Sub-project",
        "originator" => "Supplier",
        "plannedDate" => "Planned date",
        "receivedDate" => "Received date",
        "title" => "Title",
        "phase" => "Phase",
        "contractRef" => "Purchase order",
        "criticality" => "Criticality",
        "confidentiality" => "Confidentiality",
        "retentionClass" => "Retention period",
        _ => field,
    };

    /// <summary>A day as YYYY-MM-DD, from a date the file wrote (with or without its time), else null.</summary>
    private static string? Day(string text) =>
        DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var at) ? at.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : null;

    private static ImportLineView Problem(ImportLine line, string? number, Document? document, string why, IEnumerable<string>? fields = null, string? title = null) =>
        new(line.At, Outcomes.Problem, number, document?.Id, title ?? document?.Title, [], [why], fields?.ToList() ?? []);

    private static string MessageOf(IResult problem) => problem is ProblemHttpResult p ? p.ProblemDetails.Title ?? "refused" : "refused";

    /// <summary>The fields a refusal names (its <c>field</c> or <c>fields</c>), else those the line changes.</summary>
    private static List<string> FieldsOf(IResult problem, IEnumerable<string> otherwise)
    {
        if (problem is ProblemHttpResult p && p.ProblemDetails.Extensions.TryGetValue("params", out var raw) && raw is not null)
        {
            var element = JsonSerializer.SerializeToElement(raw, JsonSerializerOptions.Web);
            if (element.ValueKind == JsonValueKind.Object)
            {
                if (element.TryGetProperty("fields", out var many) && many.ValueKind == JsonValueKind.Array)
                    return [.. many.EnumerateArray().Select(f => f.GetString()).OfType<string>()];
                if (element.TryGetProperty("field", out var one) && one.GetString() is { } single) return [single];
            }
        }
        return [.. otherwise];
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
