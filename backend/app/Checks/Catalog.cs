using System.Security.Cryptography;
using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Checks;

/// <summary>How serious a check's finding is, from most to least serious. Stored on each check and copied onto each defect it finds.</summary>
public static class Severities
{
    /// <summary>The four severity codes. The defects list sorts by them in this order, and open Critical defects are counted on every run.</summary>
    public const string Critical = "CRITICAL", Major = "MAJOR", Minor = "MINOR", Advisory = "ADVISORY";
}

/// <summary>The stage of a project a check belongs to: setting it up, running it day to day, or handing it over. Shown on the checks page to group the checks.</summary>
public static class Phases
{
    /// <summary>What has to be published before the register can be trusted: an administrator's, once.</summary>
    public const string Setup = "SETUP";
    /// <summary>The register against itself, whenever the checks run.</summary>
    public const string Running = "RUNNING";
    /// <summary>What has to be settled before anything is handed over.</summary>
    public const string Handover = "HANDOVER";
}

/// <summary>One item a check found wrong.</summary>
public sealed record Failure(string EntityKey, string EntityType, Guid? EntityId, Guid? DocumentId, string Label, string? Description = null);

/// <summary>What a runner says: the failing items (none means it passed), or what must be set up before it can ask.</summary>
public abstract record Outcome
{
    /// <summary>The check ran; it lists the items it found wrong. An empty list means it passed.</summary>
    public sealed record Ran(IReadOnlyList<Failure> Failures) : Outcome;
    /// <summary>The check could not ask its question because something is not set up yet; <c>What</c> says what is missing.</summary>
    public sealed record NeedsSetup(string What) : Outcome;
}

/// <summary>
/// A question asked of the register. Only what the application can look at and
/// answer from its own records is here: a check that cannot fail, or can only
/// fail, teaches people to ignore the page. Conditions the application refuses
/// at the moment somebody tries (a typed number, a revision value used twice, a
/// record revised) are not checks: they cannot reach the register to be found.
/// </summary>
/// <param name="Owner">CF the control function · OR whoever produced it · RV the reviewer · OG the organization.</param>
public sealed record CheckDef(string Id, string Phase, string Condition, string Method, string Severity, string Owner,
    Func<CheckContext, Task<Outcome>> Run);

/// <summary>What every runner reads, loaded once per run.</summary>
public sealed class CheckContext
{
    public required DeliosDbContext Db { get; init; }
    public required Project Project { get; init; }
    /// <summary>The organization's published lists of values (statuses, verdicts, deliverable types…) with their properties, for quick lookups.</summary>
    public required Catalog Values { get; init; }
    /// <summary>Every entry of every list, including withdrawn ones; filter by status to get the published ones.</summary>
    public required IReadOnlyList<ValueEntry> ValueEntries { get; init; }
    public required FileStorage Storage { get; init; }
    public required AuditLog Audit { get; init; }
    public required IReadOnlyList<Document> Documents { get; init; }
    public required IReadOnlyList<Revision> Revisions { get; init; }
    /// <summary>The moment the run started, so every check uses the same "now".</summary>
    public required Instant Now { get; init; }
    public CancellationToken CancellationToken { get; init; }

    /// <summary>The project's released (current) revisions.</summary>
    public IEnumerable<Revision> Released => Revisions.Where(r => r.State == RevisionStates.Released);
    /// <summary>Finds the document a revision belongs to, from the documents already loaded.</summary>
    public Document DocumentOf(Revision r) => Documents.First(d => d.Id == r.DocumentId);
}

/// <summary>
/// The full list of checks (<see cref="All"/>) and the small helpers they use to build their results.
/// The check engine runs every entry in <see cref="All"/>; the check endpoints list them and look one up by its id.
/// </summary>
public static class CheckCatalog
{
    /// <summary>The result of a check that found nothing wrong.</summary>
    private static Outcome Pass => new Outcome.Ran([]);
    /// <summary>The result of a check that found these items wrong (an empty list still counts as a pass).</summary>
    private static Outcome Fail(IEnumerable<Failure> failures) => new Outcome.Ran(failures.ToList());
    /// <summary>Builds a finding about a whole document, keyed "document:{id}" so it is recognised again on the next run.</summary>
    private static Failure Doc(Document d, string? description = null) =>
        new($"document:{d.Id}", "Document", d.Id, d.Id, $"{d.Number} {d.Title}", description);
    /// <summary>Builds a finding about one revision of a document, keyed "revision:{id}".</summary>
    private static Failure Rev(Document d, Revision r, string? description = null) =>
        new($"revision:{r.Id}", "Revision", r.Id, d.Id, $"{d.Number} rev {r.Value}", description);
    /// <summary>Builds a finding about the organization's or project's settings (a list of values, a scheme), not about a document.</summary>
    private static Failure Setting(string set, string label, string? description = null) =>
        new($"settings:{set}:{label}", "Settings", null, null, label, description);

    /// <summary>True when the value <paramref name="code"/> in list <paramref name="set"/> carries the property <paramref name="prop"/>.</summary>
    private static bool Has(Catalog values, string set, string code, string prop) => values.Prop(set, code, prop) is not null;
    /// <summary>The values of one list (for example the statuses) that are currently published, that is, in use.</summary>
    private static IReadOnlyList<ValueEntry> Active(CheckContext ctx, string set) => ctx.ValueEntries.Where(v => v.SetKey == set && v.Status == ValueStatus.Active).ToList();

    /// <summary>Every check, in the order they run and are shown. Each entry gives its id, phase, condition (what it looks for), method (how), severity, owner and the code that runs it.</summary>
    public static readonly IReadOnlyList<CheckDef> All =
    [
        // ── Setting the project up ────────────────────────────────────────────
        new("SET-01", Phases.Setup, "A deliverable type no numbering scheme serves",
            "Each published deliverable type is routed to a numbering scheme (Settings → Numbering); otherwise nothing of that type can be registered", Severities.Critical, "OG", async ctx =>
            {
                var numbering = await NumberingLevels.ScopeAsync(ctx.Db, ctx.Project.Id, ctx.CancellationToken);
                var routed = await ctx.Db.SchemeRoutings.Where(r => r.ProjectId == numbering && r.Active).Select(r => r.DeliverableType).ToListAsync(ctx.CancellationToken);
                return Fail(Active(ctx, ValueSets.DeliverableTypes).Where(t => !routed.Contains(t.Code))
                    .Select(t => Setting("NUMBERING", t.Code, $"{t.Label} cannot be registered: no numbering scheme serves it.")));
            }),
        new("SET-02", Phases.Setup, "No status is published",
            "The statuses a revision is released at are published (Settings → Published lists); a status retired there leaves none", Severities.Critical, "OG", ctx =>
                Task.FromResult(Active(ctx, ReviewSets.Statuses).Count == 0 ? Fail([Setting(ReviewSets.Statuses, "Statuses")]) : Pass)),
        new("SET-03", Phases.Setup, "A status that does not say whether work may go ahead on it",
            "Every published status says whether work may go ahead on it (Settings → Published lists, Statuses: \"Allows work on site or in the shop\")", Severities.Critical, "OG", ctx =>
                Task.FromResult(Fail(Active(ctx, ReviewSets.Statuses).Where(s => !Has(ctx.Values, ReviewSets.Statuses, s.Code, "executes"))
                    .Select(s => Setting(ReviewSets.Statuses, s.Code))))),
        new("SET-04", Phases.Setup, "No verdict is published",
            "The verdicts the decider chooses from are published; a list emptied by retiring its verdicts leaves the decider nothing", Severities.Critical, "OG", ctx =>
                Task.FromResult(Active(ctx, ReviewSets.Verdicts).Count == 0 ? Fail([Setting(ReviewSets.Verdicts, "Verdicts")]) : Pass)),
        new("SET-05", Phases.Setup, "A verdict that does not say which of the four meanings it has",
            "Every published verdict says accepted, accepted with comments, rejected or for information (a list uploaded from a spreadsheet may leave it out)", Severities.Critical, "OG", ctx =>
                Task.FromResult(Fail(Active(ctx, ReviewSets.Verdicts).Where(v => !Has(ctx.Values, ReviewSets.Verdicts, v.Code, "proceed"))
                    .Select(v => Setting(ReviewSets.Verdicts, v.Code))))),
        new("SET-06", Phases.Setup, "A criticality level with no meaning",
            "Each criticality level says what it means and decides (its retention period, at least); a list uploaded from a spreadsheet may leave it out", Severities.Critical, "OG", ctx =>
                Task.FromResult(Fail(Active(ctx, ValueSets.Criticality).Where(c => c.Props is null)
                    .Select(c => Setting(ValueSets.Criticality, c.Code, $"{c.Label} changes nothing about the documents that carry it."))))),
        new("SET-07", Phases.Setup, "\"Who may see it\" has no level used when none is chosen",
            "One level of \"Who may see it\" is the default; unticked or retired, a new document starts with none", Severities.Major, "OG", ctx =>
                Task.FromResult(Active(ctx, ValueSets.Confidentiality).Count > 0 && ctx.Values.DefaultOf(ValueSets.Confidentiality) is null
                    ? Fail([Setting(ValueSets.Confidentiality, "Default level")]) : Pass)),
        new("SET-08", Phases.Setup, "No retention period used by default",
            "One retention period is the default, for a document whose criticality says none; retired, documents are left without one", Severities.Critical, "OG", ctx =>
                Task.FromResult(ctx.Values.DefaultOf(ValueSets.RetentionClasses) is null
                    ? Fail([Setting(ValueSets.RetentionClasses, "Default retention class")]) : Pass)),
        new("SET-09", Phases.Setup, "Nobody on the project receives documents",
            "At least one function on the project holds Receive in the distribution matrix; otherwise a release proposes nobody", Severities.Major, "OG", async ctx =>
                await ctx.Db.Memberships.AnyAsync(m => m.ProjectId == ctx.Project.Id && m.Active && m.Function!.Active
                    && ctx.Db.PermissionRules.IgnoreQueryFilters().Any(r => r.FunctionId == m.FunctionId && r.ProjectId == (m.Project!.OwnFunctions ? (Guid?)m.ProjectId : null) && r.Verbs.Contains(Verbs.Receive)), ctx.CancellationToken)
                    ? Pass : Fail([Setting("MATRIX", "Distribution", "The matrix proposes nobody when a document is issued.")])),
        new("DOC-01", Phases.Running, "A title that became generic",
            "Titles made only of words added to the organization's generic list after the document was registered (new titles of that kind are refused)", Severities.Minor, "OR", ctx =>
            {
                var words = ctx.Values.GenericTitleWords();
                return Task.FromResult(Fail(ctx.Documents.Where(d => Titles.IsGeneric(d.Title, words)).Select(d => Doc(d))));
            }),
        new("DOC-04", Phases.Running, "A field holds a value since retired",
            "Each document's discipline, type, criticality, \"who may see it\" and retention against the lists as published now (a value retired after use)", Severities.Major, "CF", ctx =>
                Task.FromResult(Fail(ctx.Documents.SelectMany(d => Controlled(d)
                    .Where(f => f.Value is not null && !ctx.Values.IsActive(f.Set, f.Value))
                    .Select(f => Doc(d, $"{f.Name} '{f.Value}' is not a published value.")).Take(1))))),
        new("DOC-05", Phases.Running, "No retention period on the document",
            "Documents with no retention period: none chosen, and neither its criticality nor a default gives one", Severities.Major, "OR", ctx =>
                Task.FromResult(Fail(ctx.Documents.Where(d => d.RetentionClass is null).Select(d => Doc(d))))),
        new("REV-01", Phases.Running, "A void left the document with no released revision",
            "Documents with a superseded revision and none released: the newest released one was voided and nothing replaced it", Severities.Critical, "CF", ctx =>
                Task.FromResult(Fail(ctx.Revisions.GroupBy(r => r.DocumentId)
                    .Where(g => g.Any(r => r.State == RevisionStates.Superseded) && g.All(r => r.State != RevisionStates.Released))
                    .Select(g => Doc(ctx.Documents.First(d => d.Id == g.Key)))))),
        new("REV-02", Phases.Running, "Released at a status since retired",
            "The status of each released revision against the statuses as published now", Severities.Major, "CF", ctx =>
                Task.FromResult(Fail(ctx.Released.Where(r => r.StatusCode is not null && !ctx.Values.IsActive(ReviewSets.Statuses, r.StatusCode))
                    .Select(r => Rev(ctx.DocumentOf(r), r, $"{r.StatusCode} is not a published status."))))),
        new("RVW-01", Phases.Running, "Decided with a verdict since retired",
            "Reviews decided and not yet released, whose verdict was retired since", Severities.Major, "CF", async ctx =>
            {
                var given = await ctx.Db.Reviews.Where(r => r.ProjectId == ctx.Project.Id && r.Verdict != null && r.State == ReviewStates.Decided)
                    .Select(r => new { r.Id, r.Number, r.DocumentId, r.Verdict, r.VerdictSet }).ToListAsync(ctx.CancellationToken);
                return Fail(given.Where(g => !ctx.Values.IsActive(g.VerdictSet, g.Verdict!))
                    .Select(g => new Failure($"review:{g.Id}", "Review", g.Id, g.DocumentId, g.Number, $"{g.Verdict} is not a published verdict.")));
            }),
        new("RVW-02", Phases.Running, "An open comment whose weight was retired",
            "Open comments whose weight (comment, blocking comment…) is no longer published", Severities.Major, "RV", async ctx =>
            {
                var open = await (from c in ctx.Db.ReviewComments
                                  join r in ctx.Db.Reviews on c.ReviewId equals r.Id
                                  where r.ProjectId == ctx.Project.Id && c.Status == CommentStatuses.Open
                                  select new { c.Id, c.Class, r.Number, r.DocumentId }).ToListAsync(ctx.CancellationToken);
                return Fail(open.Where(c => !ctx.Values.IsActive(ReviewSets.CommentClasses, c.Class))
                    .Select(c => new Failure($"comment:{c.Id}", "Comment", c.Id, c.DocumentId, c.Number, $"Its weight {c.Class} is no longer published.")));
            }),
        new("REV-03", Phases.Running, "Released with no native file",
            "Released revisions with no native file beside the PDF, of types that come with one (it is optional; the editable original helps the next revision)", Severities.Advisory, "OR", async ctx =>
            {
                var released = ctx.Released.Select(r => r.Id).ToList();
                var withNative = (await ctx.Db.StoredFiles.Where(f => f.RevisionId != null && released.Contains(f.RevisionId.Value)
                    && f.Kind == FileKinds.Native).Select(f => f.RevisionId!.Value).Distinct().ToListAsync(ctx.CancellationToken)).ToHashSet();
                // A type made as a PDF only (Types & sets, on the type: "A PDF only") never has one: not asked of it.
                bool pdfOnly(Document d) => ctx.Values.Prop(ValueSets.DocumentTypes, d.DocType, "native") is { ValueKind: JsonValueKind.False };
                return Fail(ctx.Released.Where(r => !withNative.Contains(r.Id) && !pdfOnly(ctx.DocumentOf(r))).Select(r => Rev(ctx.DocumentOf(r), r)));
            }),
        new("STO-01", Phases.Running, "A file the register lists is missing from storage (outside the app)",
            "Asks storage for a sample of current files, 25 a run", Severities.Critical, "CF", async ctx =>
            {
                var failures = new List<Failure>();
                foreach (var f in await SampleAsync(ctx, 25))
                {
                    var size = await ctx.Storage.SizeAsync(f.ObjectKey, ctx.CancellationToken);
                    if (size != f.Size) failures.Add(FileFailure(ctx, f, size is null ? "Missing from storage." : $"{size} bytes stored, {f.Size} recorded."));
                }
                return Fail(failures);
            }),
        new("STO-02", Phases.Running, "A file changed in storage after it was kept (outside the app)",
            "Re-reads a sample of current files, 5 a run, against the fingerprint taken on arrival", Severities.Critical, "CF", async ctx =>
            {
                var failures = new List<Failure>();
                foreach (var f in await SampleAsync(ctx, 5))
                {
                    try
                    {
                        await using var content = await ctx.Storage.OpenReadAsync(f.ObjectKey, ctx.CancellationToken);
                        var hash = Convert.ToHexStringLower(await SHA256.HashDataAsync(content, ctx.CancellationToken));
                        if (hash != f.Sha256) failures.Add(FileFailure(ctx, f, "Its bytes no longer match the fingerprint taken when it arrived."));
                    }
                    catch (Exception e) when (e is not OperationCanceledException)
                    {
                        failures.Add(FileFailure(ctx, f, "It could not be read back."));
                    }
                }
                return Fail(failures);
            }),
        new("REV-04", Phases.Running, "Released and never sent",
            "Released revisions no transmittal carried (other than for review): only when the project releases and issues separately, or a type released with no review", Severities.Advisory, "CF", async ctx =>
            {
                var released = ctx.Released.Select(r => r.Id).ToList();
                var sent = (await (from i in ctx.Db.TransmittalItems
                                   join t in ctx.Db.Transmittals on i.TransmittalId equals t.Id
                                   where i.RevisionId != null && released.Contains(i.RevisionId.Value) && t.ReviewStepId == null
                                   select i.RevisionId!.Value).Distinct().ToListAsync(ctx.CancellationToken)).ToHashSet();
                return Fail(ctx.Released.Where(r => !sent.Contains(r.Id)).Select(r => Rev(ctx.DocumentOf(r), r)));
            }),
        new("STO-03", Phases.Running, "The history has a broken link (outside the app)",
            "Recomputes the hash chain of the organization's audit trail, once for all the projects checked in the hour", Severities.Critical, "CF", async ctx =>
                await ctx.Audit.FirstBrokenLinkOnceAsync(ctx.CancellationToken) is { } at
                    ? Fail([new Failure("audit:chain", "Audit", null, null, "Audit trail", $"The chain breaks at entry {at}: something was altered.")])
                    : Pass),

        // ── The schedule ──────────────────────────────────────────────────────
        new("SET-11", Phases.Setup, "A schedule is followed but no \"Went ahead?\" answers are published",
            "With a schedule, the answers to \"Went ahead?\" (went ahead, postponed…) are published, each saying whether the action went ahead", Severities.Major, "OG", async ctx =>
            {
                if (!await ctx.Db.ScheduleSources.AnyAsync(s => s.ProjectId == ctx.Project.Id, ctx.CancellationToken)) return Pass;
                var decisions = Active(ctx, Actions.ScheduleSets.Decisions);
                if (decisions.Count == 0)
                    return Fail([Setting(Actions.ScheduleSets.Decisions, "Went ahead? answers", "Nothing can be recorded when an action does not go ahead.")]);
                return Fail(decisions.Where(d => !Has(ctx.Values, Actions.ScheduleSets.Decisions, d.Code, "proceeds"))
                    .Select(d => Setting(Actions.ScheduleSets.Decisions, d.Code, $"{d.Label} does not say whether the action went ahead.")));
            }),
        new("SCH-01", Phases.Running, "The released schedule could not be read",
            "The schedule document's released revision against what was read from it (also on Home)", Severities.Major, "CF", async ctx =>
            {
                var source = await ctx.Db.ScheduleSources.AsNoTracking().SingleOrDefaultAsync(s => s.ProjectId == ctx.Project.Id, ctx.CancellationToken);
                if (source is null) return Pass;
                var current = ctx.Released.FirstOrDefault(r => r.DocumentId == source.DocumentId);
                if (current is null) return Pass;
                var read = await ctx.Db.ScheduleImports.AsNoTracking().SingleOrDefaultAsync(i => i.RevisionId == current.Id, ctx.CancellationToken);
                return read is { Status: Actions.ScheduleImportStatuses.Failed }
                    ? Fail([Rev(ctx.DocumentOf(current), current, $"Its actions were not read: {read.Error}")])
                    : Pass;
            }),
        new("SCH-02", Phases.Running, "An action past its day that a concerned discipline has not confirmed",
            "Actions past their day, not postponed, with a document still missing, where a concerned discipline has not confirmed going ahead (by hand or automatically)", Severities.Major, "CF", async ctx =>
            {
                var today = ctx.Now.InZone(DateTimeZoneProviders.Tzdb.GetZoneOrNull(ctx.Project.TimeZone) ?? DateTimeZone.Utc).Date;
                var past = await ctx.Db.Activities.AsNoTracking()
                    .Where(a => a.ProjectId == ctx.Project.Id && a.State == Actions.ActivityStates.Active && a.Start != null && a.Start < today
                        && a.MetCount + a.WaivedCount < a.NeedCount
                        && !ctx.Db.ActivityDecisions.Any(d => d.ActivityId == a.Id))
                    .ToListAsync(ctx.CancellationToken);
                var ids = past.Select(a => a.Id).ToList();
                var confirmed = (await ctx.Db.Set<Records.ReadinessConfirmation>().AsNoTracking()
                    .Where(c => ids.Contains(c.ActivityId) && c.RevokedAt == null).Select(c => new { c.ActivityId, c.Department })
                    .ToListAsync(ctx.CancellationToken)).ToLookup(c => c.ActivityId, c => c.Department);
                return Fail(past.Select(a => (a, silent: a.Departments.Where(d => !confirmed[a.Id].Contains(d)).ToList()))
                    .Where(x => x.silent.Count > 0)
                    .Select(x => new Failure($"activity:{x.a.Id}", "Action", x.a.Id, null, $"{x.a.Code} {x.a.Name}",
                        $"Its day was {x.a.Start}; {string.Join(", ", x.silent)} {(x.silent.Count == 1 ? "has" : "have")} not confirmed going ahead without what is missing.")));
            }),

        // ── Closing and handing over ──────────────────────────────────────────
        new("PKG-01", Phases.Handover, "A delivery package not checked for readiness by its date",
            "Open delivery packages past their date whose readiness was never checked (a supplier's package has no single date)", Severities.Major, "CF", async ctx =>
            {
                var today = ctx.Now.InZone(DateTimeZoneProviders.Tzdb.GetZoneOrNull(ctx.Project.TimeZone) ?? DateTimeZone.Utc).Date;
                var late = await ctx.Db.Packages.Where(p => p.ProjectId == ctx.Project.Id && p.State == Packages.PackageStates.Open
                    && p.CompletionDate != null && p.CompletionDate < today && p.AssessedAt == null).ToListAsync(ctx.CancellationToken);
                return Fail(late.Select(p => new Failure($"package:{p.Id}", "Package", p.Id, null, $"{p.Number} {p.Title}",
                    $"Due {p.CompletionDate}; readiness not checked.")));
            }),
    ];

    /// <summary>The checks indexed by their id, for quick lookup by <see cref="Find"/>.</summary>
    private static readonly Dictionary<string, CheckDef> ById = All.ToDictionary(c => c.Id);
    /// <summary>Finds a check by its id (for example "REV-03"), or null if there is none. Used by the endpoints that switch a check off.</summary>
    public static CheckDef? Find(string id) => ById.GetValueOrDefault(id);

    /// <summary>True when the named document field is empty. Used by MD-03 to compare a document against the fields its deliverable type requires; an unknown field name counts as filled.</summary>
    private static bool Empty(Document d, string field) => field switch
    {
        "originator" => string.IsNullOrEmpty(d.Originator),
        "contractRef" => string.IsNullOrEmpty(d.ContractRef),
        "receivedDate" => d.ReceivedDate is null,
        "subproject" => string.IsNullOrEmpty(d.Subproject),
        "criticality" => string.IsNullOrEmpty(d.Criticality),
        "confidentiality" => string.IsNullOrEmpty(d.Confidentiality),
        "plannedDate" => d.PlannedDate is null,
        _ => false,
    };

    /// <summary>The document's fields whose values must come from a published list, with the list each one draws from. Used by MD-06.</summary>
    private static IEnumerable<(string Name, string Set, string? Value)> Controlled(Document d) =>
    [
        ("Deliverable type", ValueSets.DeliverableTypes, d.DeliverableType),
        ("Document type", ValueSets.DocumentTypes, d.DocType),
        ("Discipline", ValueSets.Disciplines, d.Discipline),
        ("Subproject", ValueSets.Subprojects, d.Subproject),
        ("Criticality", ValueSets.Criticality, d.Criticality),
        ("Confidentiality", ValueSets.Confidentiality, d.Confidentiality),
        ("Retention class", ValueSets.RetentionClasses, d.RetentionClass),
    ];

    /// <summary>A different sample of current files each run, so over time every one is looked at.</summary>
    private static async Task<List<StoredFile>> SampleAsync(CheckContext ctx, int size)
    {
        var current = ctx.Released.Select(r => r.Id).ToList();
        var files = await ctx.Db.StoredFiles.AsNoTracking()
            .Where(f => f.RevisionId != null && current.Contains(f.RevisionId.Value) && f.Status == FileStatuses.Clean)
            .ToListAsync(ctx.CancellationToken);
        return files.OrderBy(_ => Random.Shared.Next()).Take(size).ToList();
    }

    /// <summary>Builds a finding about a stored file that is missing or changed, labelled with its document number and file name. Used by FM-06 and FM-07.</summary>
    private static Failure FileFailure(CheckContext ctx, StoredFile f, string description)
    {
        var document = ctx.Documents.FirstOrDefault(d => d.Id == f.DocumentId);
        return new Failure($"file:{f.Id}", "File", f.Id, f.DocumentId, $"{document?.Number} {f.Name}", description);
    }
}
