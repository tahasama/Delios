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
    /// <summary>The register against itself, every day.</summary>
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
/// <param name="Owner">CF Document Control · OR whoever produced it · RV the reviewer · OG the organization.</param>
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
        new("ID-05", Phases.Setup, "A deliverable type with no numbering scheme",
            "Each published deliverable type is routed to a numbering scheme", Severities.Critical, "OG", async ctx =>
            {
                var routed = await ctx.Db.SchemeRoutings.Where(r => r.Active).Select(r => r.DeliverableType).ToListAsync(ctx.CancellationToken);
                return Fail(Active(ctx, ValueSets.DeliverableTypes).Where(t => !routed.Contains(t.Code))
                    .Select(t => Setting("NUMBERING", t.Code, $"{t.Label} cannot be registered: no numbering scheme serves it.")));
            }),
        new("RV-01", Phases.Setup, "No revision scheme for a deliverable type",
            "Each deliverable type has a revision scheme routed to it, or a default exists", Severities.Critical, "OG", async ctx =>
            {
                if (await ctx.Db.RevisionSchemes.AnyAsync(s => s.IsDefault, ctx.CancellationToken)) return Pass;
                var routed = await ctx.Db.RevisionSchemeRoutings.Select(r => r.DeliverableType).ToListAsync(ctx.CancellationToken);
                return Fail(Active(ctx, ValueSets.DeliverableTypes).Where(t => !routed.Contains(t.Code))
                    .Select(t => Setting("REVISION_SCHEMES", t.Code, $"{t.Label} has no revision scheme and there is no default.")));
            }),
        new("ST-04", Phases.Setup, "No list of statuses published",
            "The statuses a released revision may carry are published", Severities.Critical, "OG", ctx =>
                Task.FromResult(Active(ctx, ReviewSets.Statuses).Count == 0 ? Fail([Setting(ReviewSets.Statuses, "Statuses")]) : Pass)),
        new("ST-06", Phases.Setup, "A status that does not say whether work may proceed on it",
            "Every published status carries 'executes'", Severities.Critical, "OG", ctx =>
                Task.FromResult(Fail(Active(ctx, ReviewSets.Statuses).Where(s => !Has(ctx.Values, ReviewSets.Statuses, s.Code, "executes"))
                    .Select(s => Setting(ReviewSets.Statuses, s.Code))))),
        new("RO-01", Phases.Setup, "No list of review verdicts published",
            "The deciding step's verdicts are published", Severities.Critical, "OG", ctx =>
                Task.FromResult(Active(ctx, ReviewSets.Verdicts).Count == 0 ? Fail([Setting(ReviewSets.Verdicts, "Verdicts")]) : Pass)),
        new("RO-03", Phases.Setup, "A verdict that does not say whether work may proceed",
            "Every published verdict carries 'proceed'", Severities.Critical, "OG", ctx =>
                Task.FromResult(Fail(Active(ctx, ReviewSets.Verdicts).Where(v => !Has(ctx.Values, ReviewSets.Verdicts, v.Code, "proceed"))
                    .Select(v => Setting(ReviewSets.Verdicts, v.Code))))),
        new("CL-06", Phases.Setup, "A criticality class that decides nothing",
            "Each criticality class says what follows from it (its retention, at least)", Severities.Critical, "OG", ctx =>
                Task.FromResult(Fail(Active(ctx, ValueSets.Criticality).Where(c => c.Props is null)
                    .Select(c => Setting(ValueSets.Criticality, c.Code, $"{c.Label} changes nothing about the documents that carry it."))))),
        new("CL-07", Phases.Setup, "Confidentiality levels with no default",
            "A default level is published for documents that state none", Severities.Major, "OG", ctx =>
                Task.FromResult(Active(ctx, ValueSets.Confidentiality).Count > 0 && ctx.Values.DefaultOf(ValueSets.Confidentiality) is null
                    ? Fail([Setting(ValueSets.Confidentiality, "Default level")]) : Pass)),
        new("RT-01", Phases.Setup, "No retention classes, or none by default",
            "Retention classes are published and one is the default", Severities.Critical, "OG", ctx =>
                Task.FromResult(ctx.Values.DefaultOf(ValueSets.RetentionClasses) is null
                    ? Fail([Setting(ValueSets.RetentionClasses, "Default retention class")]) : Pass)),
        new("IS-06", Phases.Setup, "Nobody receives documents",
            "At least one function on the project holds RECEIVE in the matrix", Severities.Major, "OG", async ctx =>
                await ctx.Db.Memberships.AnyAsync(m => m.ProjectId == ctx.Project.Id && m.Active && m.Function!.Active
                    && m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Receive)), ctx.CancellationToken)
                    ? Pass : Fail([Setting("MATRIX", "Distribution", "The matrix proposes nobody when a document is issued.")])),
        new("IS-09", Phases.Setup, "A reason for issue that wants an answer but sets no period",
            "Reasons with 'response' carry 'responseDays'", Severities.Major, "OG", ctx =>
                Task.FromResult(Fail(Active(ctx, TransmittalSets.Reasons)
                    .Where(r => ctx.Values.Prop(TransmittalSets.Reasons, r.Code, "response") is { ValueKind: JsonValueKind.True }
                        && !Has(ctx.Values, TransmittalSets.Reasons, r.Code, "responseDays"))
                    .Select(r => Setting(TransmittalSets.Reasons, r.Code))))),

        // ── While the work runs ───────────────────────────────────────────────
        new("MD-02", Phases.Running, "A title that says nothing about the document",
            "Titles made only of the organization's generic words", Severities.Minor, "OR", ctx =>
            {
                var words = ctx.Values.GenericTitleWords();
                return Task.FromResult(Fail(ctx.Documents.Where(d => Titles.IsGeneric(d.Title, words)).Select(d => Doc(d))));
            }),
        new("MD-03", Phases.Running, "A field its deliverable type requires is empty",
            "The deliverable type's 'required' list against each document", Severities.Major, "OR", ctx =>
                Task.FromResult(Fail(ctx.Documents.SelectMany(d => ctx.Values.RequiredFieldsOf(d.DeliverableType)
                    .Where(field => Empty(d, field)).Select(field => Doc(d, $"{field} is required for {d.DeliverableType} and is empty."))
                    .Take(1))))),
        new("MD-05", Phases.Running, "A document from another organization with no date received",
            "Documents whose originator is an outside party, with the received date empty", Severities.Major, "CF", async ctx =>
            {
                var outside = await ctx.Db.Parties.Where(p => !p.IsInternal).Select(p => p.Code).ToListAsync(ctx.CancellationToken);
                return Fail(ctx.Documents.Where(d => d.Originator is not null && outside.Contains(d.Originator) && d.ReceivedDate is null)
                    .Select(d => Doc(d)));
            }),
        new("MD-06", Phases.Running, "A field holds a value that is not in its list",
            "Each controlled field against the list it draws from, as published now", Severities.Major, "CF", ctx =>
                Task.FromResult(Fail(ctx.Documents.SelectMany(d => Controlled(d)
                    .Where(f => f.Value is not null && !ctx.Values.IsActive(f.Set, f.Value))
                    .Select(f => Doc(d, $"{f.Name} '{f.Value}' is not a published value.")).Take(1))))),
        new("CL-05", Phases.Running, "Criticality missing",
            "Where criticality classes are published, documents carrying none", Severities.Major, "OR", ctx =>
                Task.FromResult(Active(ctx, ValueSets.Criticality).Count == 0 ? (Outcome)new Outcome.NeedsSetup("No criticality classes are published.")
                    : Fail(ctx.Documents.Where(d => d.Criticality is null).Select(d => Doc(d))))),
        new("RT-03", Phases.Running, "No retention class on the document",
            "Documents carrying none", Severities.Major, "OR", ctx =>
                Task.FromResult(Fail(ctx.Documents.Where(d => d.RetentionClass is null).Select(d => Doc(d))))),
        new("RV-05", Phases.Running, "Two revisions of one document in motion at once",
            "Revisions in preparation, in review, received or being corrected, per document", Severities.Major, "CF", ctx =>
                Task.FromResult(Fail(ctx.Revisions.Where(r => RevisionStates.InMotion(r.State)).GroupBy(r => r.DocumentId)
                    .Where(g => g.Count() > 1).Select(g => Doc(ctx.Documents.First(d => d.Id == g.Key),
                        $"Revisions {string.Join(", ", g.Select(r => r.Value))} are all in motion."))))),
        new("RV-08", Phases.Running, "Two current revisions of one document",
            "Released revisions per document that nothing superseded", Severities.Critical, "CF", ctx =>
                Task.FromResult(Fail(ctx.Released.GroupBy(r => r.DocumentId).Where(g => g.Count() > 1)
                    .Select(g => Doc(ctx.Documents.First(d => d.Id == g.Key),
                        $"Revisions {string.Join(", ", g.Select(r => r.Value))} are all current."))))),
        new("RV-09", Phases.Running, "A document once released with nothing current now",
            "Documents with a superseded revision and no released one", Severities.Critical, "CF", ctx =>
                Task.FromResult(Fail(ctx.Revisions.GroupBy(r => r.DocumentId)
                    .Where(g => g.Any(r => r.State == RevisionStates.Superseded) && g.All(r => r.State != RevisionStates.Released))
                    .Select(g => Doc(ctx.Documents.First(d => d.Id == g.Key)))))),
        new("ST-03", Phases.Running, "Released with no status",
            "Released revisions whose status is empty", Severities.Critical, "CF", ctx =>
                Task.FromResult(Fail(ctx.Released.Where(r => string.IsNullOrEmpty(r.StatusCode)).Select(r => Rev(ctx.DocumentOf(r), r))))),
        new("ST-05", Phases.Running, "Released at a status that is no longer published",
            "The status of each current revision against the published list", Severities.Major, "CF", ctx =>
                Task.FromResult(Fail(ctx.Released.Where(r => r.StatusCode is not null && !ctx.Values.IsActive(ReviewSets.Statuses, r.StatusCode))
                    .Select(r => Rev(ctx.DocumentOf(r), r, $"{r.StatusCode} is not a published status."))))),
        new("AP-01", Phases.Running, "Released with nobody's decision on record",
            "Released or superseded revisions with no review that released them", Severities.Critical, "CF", async ctx =>
            {
                var decided = await ctx.Db.Reviews.Where(r => r.ProjectId == ctx.Project.Id && r.State == ReviewStates.Released)
                    .Select(r => r.RevisionId).ToListAsync(ctx.CancellationToken);
                var set = decided.ToHashSet();
                return Fail(ctx.Revisions.Where(r => r.State is RevisionStates.Released or RevisionStates.Superseded && !set.Contains(r.Id))
                    .Select(r => Rev(ctx.DocumentOf(r), r)));
            }),
        new("RO-02", Phases.Running, "A verdict that is no longer published",
            "Verdicts given on reviews still open or decided, against the published list", Severities.Major, "CF", async ctx =>
            {
                var given = await ctx.Db.Reviews.Where(r => r.ProjectId == ctx.Project.Id && r.Verdict != null && r.State == ReviewStates.Decided)
                    .Select(r => new { r.Id, r.Number, r.DocumentId, r.Verdict }).ToListAsync(ctx.CancellationToken);
                return Fail(given.Where(g => !ctx.Values.IsActive(ReviewSets.Verdicts, g.Verdict!))
                    .Select(g => new Failure($"review:{g.Id}", "Review", g.Id, g.DocumentId, g.Number, $"{g.Verdict} is not a published verdict.")));
            }),
        new("RO-06", Phases.Running, "An open comment whose class is no longer published",
            "Open comments' classes against the published list", Severities.Major, "RV", async ctx =>
            {
                var open = await (from c in ctx.Db.ReviewComments
                                  join r in ctx.Db.Reviews on c.ReviewId equals r.Id
                                  where r.ProjectId == ctx.Project.Id && c.Status == CommentStatuses.Open
                                  select new { c.Id, c.Class, r.Number, r.DocumentId }).ToListAsync(ctx.CancellationToken);
                return Fail(open.Where(c => !ctx.Values.IsActive(ReviewSets.CommentClasses, c.Class))
                    .Select(c => new Failure($"comment:{c.Id}", "Comment", c.Id, c.DocumentId, c.Number, $"{c.Class} is not a published comment class.")));
            }),
        new("FM-01", Phases.Running, "The editable original was not kept",
            "Current revisions with no native file beside the PDF", Severities.Major, "OR", async ctx =>
            {
                var released = ctx.Released.Select(r => r.Id).ToList();
                var withNative = (await ctx.Db.StoredFiles.Where(f => f.RevisionId != null && released.Contains(f.RevisionId.Value)
                    && f.Kind == FileKinds.Native).Select(f => f.RevisionId!.Value).Distinct().ToListAsync(ctx.CancellationToken)).ToHashSet();
                return Fail(ctx.Released.Where(r => !withNative.Contains(r.Id)).Select(r => Rev(ctx.DocumentOf(r), r)));
            }),
        new("FM-06", Phases.Running, "A file the register lists is missing from storage",
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
        new("FM-07", Phases.Running, "A file changed after it was stored",
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
        new("IS-11", Phases.Running, "Released and never sent",
            "Current revisions no transmittal has carried, other than for review", Severities.Advisory, "CF", async ctx =>
            {
                var released = ctx.Released.Select(r => r.Id).ToList();
                var sent = (await (from i in ctx.Db.TransmittalItems
                                   join t in ctx.Db.Transmittals on i.TransmittalId equals t.Id
                                   where released.Contains(i.RevisionId) && t.ReviewStepId == null
                                   select i.RevisionId).Distinct().ToListAsync(ctx.CancellationToken)).ToHashSet();
                return Fail(ctx.Released.Where(r => !sent.Contains(r.Id)).Select(r => Rev(ctx.DocumentOf(r), r)));
            }),
        new("RG-01", Phases.Running, "The audit trail has a broken link",
            "Recomputes the hash chain of the organization's audit trail", Severities.Critical, "CF", async ctx =>
                await ctx.Audit.FirstBrokenLinkAsync(ctx.CancellationToken) is { } at
                    ? Fail([new Failure("audit:chain", "Audit", null, null, "Audit trail", $"The chain breaks at entry {at}: something was altered.")])
                    : Pass),

        // ── The schedule ──────────────────────────────────────────────────────
        new("SC-04", Phases.Setup, "A schedule is followed but no activity decisions are published",
            "Projects with a schedule document have a list of decisions, each saying whether the activity went ahead", Severities.Major, "OG", async ctx =>
            {
                if (!await ctx.Db.ScheduleSources.AnyAsync(s => s.ProjectId == ctx.Project.Id, ctx.CancellationToken)) return Pass;
                var decisions = Active(ctx, Schedules.ScheduleSets.Decisions);
                if (decisions.Count == 0)
                    return Fail([Setting(Schedules.ScheduleSets.Decisions, "Activity decisions", "Nothing can be recorded when an activity's documents are missing.")]);
                return Fail(decisions.Where(d => !Has(ctx.Values, Schedules.ScheduleSets.Decisions, d.Code, "proceeds"))
                    .Select(d => Setting(Schedules.ScheduleSets.Decisions, d.Code, $"{d.Label} does not say whether the activity went ahead.")));
            }),
        new("SC-01", Phases.Running, "The released schedule could not be read",
            "The schedule document's current revision against what was read from it", Severities.Major, "CF", async ctx =>
            {
                var source = await ctx.Db.ScheduleSources.AsNoTracking().SingleOrDefaultAsync(s => s.ProjectId == ctx.Project.Id, ctx.CancellationToken);
                if (source is null) return Pass;
                var current = ctx.Released.FirstOrDefault(r => r.DocumentId == source.DocumentId);
                if (current is null) return Pass;
                var read = await ctx.Db.ScheduleImports.AsNoTracking().SingleOrDefaultAsync(i => i.RevisionId == current.Id, ctx.CancellationToken);
                return read is { Status: Schedules.ScheduleImportStatuses.Failed }
                    ? Fail([Rev(ctx.DocumentOf(current), current, $"Its activities were not read: {read.Error}")])
                    : Pass;
            }),
        new("SC-02", Phases.Running, "An activity started without its documents and nobody decided",
            "Activities past their start with a document still missing and no decision recorded", Severities.Major, "CF", async ctx =>
            {
                var today = WorkingCalendar.Today(SystemClock.Instance, ctx.Project.TimeZone);
                var started = await ctx.Db.Activities.AsNoTracking()
                    .Where(a => a.ProjectId == ctx.Project.Id && a.State == Schedules.ActivityStates.Active && a.Start != null && a.Start <= today
                        && a.MetCount + a.WaivedCount < a.NeedCount
                        && !ctx.Db.ActivityDecisions.Any(d => d.ActivityId == a.Id))
                    .ToListAsync(ctx.CancellationToken);
                return Fail(started.Select(a => new Failure($"activity:{a.Id}", "Activity", a.Id, null, $"{a.Code} {a.Name}",
                    $"Started {a.Start}; {a.NeedCount - a.MetCount - a.WaivedCount} document(s) missing. Record whether it went ahead or stopped.")));
            }),
        new("SC-03", Phases.Running, "A waived document never came",
            "Waived needs whose activity has finished (or started, with no finish) and whose document is still not there", Severities.Minor, "OR", async ctx =>
            {
                var today = WorkingCalendar.Today(SystemClock.Instance, ctx.Project.TimeZone);
                var open = await (from n in ctx.Db.Requirements
                                  join a in ctx.Db.Activities on n.ActivityId equals a.Id
                                  where a.ProjectId == ctx.Project.Id && n.State == Schedules.RequirementStates.Waived
                                      && (a.Finish ?? a.Start) != null && (a.Finish ?? a.Start) < today
                                  select new { n.Id, n.DocumentId, n.WaiverNote, a.Code, a.Name }).ToListAsync(ctx.CancellationToken);
                return Fail(open.Select(n => new Failure($"need:{n.Id}", "Activity", n.Id, n.DocumentId, $"{n.Code} {n.Name}",
                    $"Waived: \"{n.WaiverNote}\". The document is still not there.")));
            }),

        // ── Closing and handing over ──────────────────────────────────────────
        new("PK-06", Phases.Handover, "A package not assessed by its completion date",
            "Open packages past their completion date with no assessment since", Severities.Major, "CF", async ctx =>
            {
                var today = WorkingCalendar.Today(SystemClock.Instance, ctx.Project.TimeZone);
                var late = await ctx.Db.Packages.Where(p => p.ProjectId == ctx.Project.Id && p.State == Packages.PackageStates.Open
                    && p.CompletionDate != null && p.CompletionDate < today && p.AssessedAt == null).ToListAsync(ctx.CancellationToken);
                return Fail(late.Select(p => new Failure($"package:{p.Id}", "Package", p.Id, null, $"{p.Number} {p.Title}",
                    $"Due {p.CompletionDate}; not assessed.")));
            }),
    ];

    /// <summary>The checks indexed by their id, for quick lookup by <see cref="Find"/>.</summary>
    private static readonly Dictionary<string, CheckDef> ById = All.ToDictionary(c => c.Id);
    /// <summary>Finds a check by its id (for example "RV-08"), or null if there is none. Used by the endpoints that switch a check off.</summary>
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
