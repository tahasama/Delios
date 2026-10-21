using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Settings;

/// <summary>One setting a project may be left free to change, or not, as the organization's switches read it.</summary>
/// <param name="Key">The switch's key, kept as <c>LIBERTY:{Key}</c> in the organization's settings.</param>
/// <param name="Area">Where it is set: the Settings page it belongs to.</param>
/// <param name="Why">What depends on it, in plain words: why it starts where it does.</param>
/// <param name="FreeByDefault">Where the switch stands until an administrator moves it.</param>
public sealed record LibertyItem(string Key, string Area, string Title, string Why, bool FreeByDefault);

/// <summary>A switch as the screens read it: where it stands, whether it was moved, and when it cannot be moved.</summary>
public sealed record LibertyView(string Key, string Area, string Title, string Why, bool Free, bool FreeByDefault,
    DateTimeOffset? ChangedAt, string? ChangedBy, string? Locked);

/// <summary>
/// Two levels of settings (owner): the organization's is everything the app gives by default, adapted by its
/// administrator, and it is the default of every project; a project inherits it, and changes only what the organization
/// left free. Each setting has one switch here, on the organization's level: <b>Fixed</b> (every project uses the
/// organization's as it is) or <b>Free</b> (a project may take its own copy and change it; the organization's later
/// changes never touch that copy). A switch made stricter later never undoes what a project already changed: it stays,
/// read as changed before the rule, and nothing more can be changed. Settings that can only be one level's have no switch
/// (the organizations and their identity, sign-in, what is kept about activity, the audit trail and the defaults are the
/// organization's; the project itself, its organizations, people and control function are the project's).
/// </summary>
public static class Liberty
{
    public const string Prefix = "LIBERTY:";
    public const string Free = "FREE";
    public const string Fixed = "FIXED";

    public const string Numbering = "NUMBERING";
    public const string Revisions = "REVISIONS";
    public const string Forms = "FORMS";
    public const string Routes = "ROUTES";
    public const string Functions = "FUNCTIONS";
    /// <summary>The switch of one list of Types &amp; sets.</summary>
    public static string ListKey(string setKey) => $"LIST:{setKey}";

    private const string Lists = "Types & sets";
    private const string Room = "Control room";
    private const string Stamp = "The stamp";

    /// <summary>
    /// Every switch the app has, the app's lists included, with where it starts and why. The organization's own lists are
    /// added to these when read (<see cref="ReadAsync"/>), free unless a number part reads them.
    /// </summary>
    public static readonly IReadOnlyList<LibertyItem> Items =
    [
        new(Numbering, "Numbering", "Numbering", "How every number is built, and which scheme numbers what: one numbering across projects", false),
        new(Revisions, "Revisions", "Revisions", "How revisions are named, line by line for each phase", false),

        new(ListKey(ValueSets.DeliverableTypes), Lists, "Deliverable types", "They pick the numbering, the revision scheme, the verdicts, the values a form offers, and whether a document is another organization's", false),
        new(ListKey("DELIVERABLE_TYPE_FIELDS"), Lists, "Deliverable type fields", "They go with the deliverable types", false),
        new(ListKey(ValueSets.DocumentTypes), Lists, "Document types", "A part of the number; each recommends a criticality", false),
        new(ListKey(ValueSets.Disciplines), Lists, "Disciplines", "Numbering, the distribution matrix, actions and reports by discipline read them", false),
        new(ListKey(ValueSets.Subprojects), Lists, "Sub-projects", "They exist inside one project only", true),
        new(ListKey(ValueSets.PurchaseOrders), Lists, "Purchase orders", "The project's own contracts", true),
        new(ListKey(ValueSets.GenericTitleWords), Lists, "Generic title words", "Wording only", true),
        new(ListKey(ValueSets.Criticality), Lists, "Criticality", "Rights, routes and the recommended levels read it", false),
        new(ListKey(ValueSets.Confidentiality), Lists, "Confidentiality", "A function's clearance reads it, and functions are the organization's", false),
        new(ListKey(ValueSets.RetentionClasses), Lists, "Retention", "How long things are kept is the law's, the same on every project", false),
        new(ListKey(ValueSets.Phases), Lists, "Phases", "The revision schemes have one line per phase", false),
        new(ListKey(ReviewSets.Verdicts), Lists, "Review outcomes", "Search and analysis across projects read the verdicts and what each means", false),
        new(ListKey(ReviewSets.Advice), Lists, "Review advice", "Search and analysis across projects read it", false),
        new(ListKey(ReviewSets.CommentClasses), Lists, "Comment classes", "Search and analysis across projects read them; one blocks the work", false),
        new(ListKey(ReviewSets.Statuses), Lists, "Statuses", "\"Issued for\", \"released at its status\", the schedule and the reports read them", false),
        new(ListKey("REASONS_FOR_ISSUE"), Lists, "Reasons for issue", "The app reads them: a transmittal's kind, for update (IFU), what answer is expected", false),
        new(ListKey("ISSUE_CODES"), Lists, "Issue codes", "Each maps to a reason for issue", false),
        new(ListKey(ReviewSets.ReturnReasons), Lists, "Return reasons", "Wording of the project's own checks", true),
        new(ListKey(ReviewSets.ControlOutcomes), Lists, "Control outcomes", "Wording of the project's own checks", true),
        new(ListKey("NATIVE_FORMATS"), Lists, "Native formats", "They follow the software each project uses", true),
        new(ListKey("RENDITION_FORMATS"), Lists, "Rendition formats", "They follow the software each project uses", true),
        new(ListKey("PRESERVATION_FORMATS"), Lists, "Preservation formats", "What is kept for the long term is the law's", false),
        new(ListKey(Actions.ScheduleSets.Decisions), Lists, "Activity decisions", "\"Postponed\" is read from what they mean, and the reports read them", false),

        new(Forms, "Forms & fields", "Forms & fields", "A client may ask fields of its own; a field a number part reads follows the numbering", true),
        new(Routes, "Review routes", "Review routes", "Each project has its own reviewers and steps", true),
        new(Functions, "Functions & permissions", "Functions & permissions", "Each project's team shares out the work its own way; the administrators' function stays the organization's", true),

        new("WHO_DOES_WHAT", Room, "Who carries each act out, and what is confirmed", "The project's contract and team", true),
        new("POLICY_RELEASE", Room, "What releasing a revision means", "The project's contract", true),
        new("POLICY_PDF_STAMP", Stamp, "The stamp", "What the project's client asks of the PDFs it receives", true),
        new("POLICY_READY", Room, "When an action has what it needs", "The project's way of planning", true),
        new("POLICY_MATRIX", Room, "Who may be put on a review", "The project's team", true),
        new("POLICY_MATRIX_DETAIL", Room, "How fine the distribution matrix is cut", "The project's team", true),
        new("RISK_WINDOW", Room, "The risk window", "The project's way of planning", true),
        new("ESCALATE_AFTER_DAYS", Room, "Days before a silent discipline is notified again", "The project's way of planning", true),
        new("SUPPLIER_INTAKE", Room, "How other organizations' documents come in: by placeholder, or as they come", "The project's contract with its suppliers", true),
    ];

    /// <summary>Every switch, the organization's own lists included, as it stands.</summary>
    public static async Task<List<LibertyView>> ReadAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var rows = await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == null && (s.Key.StartsWith(Prefix) || s.Key.StartsWith("SET:")))
            .ToListAsync(cancellationToken);
        var items = Items.ToList();
        // The organization's own lists (document fields), after the app's: free unless numbering reads them.
        foreach (var row in rows.Where(r => r.Key.StartsWith("SET:")).OrderBy(r => r.Key))
        {
            var key = row.Key[4..];
            var meta = ListRules.ListMeta.Read(row.Value);
            if (ListRules.IsAppList(key) || meta.Kind == "VERDICTS" || items.Any(i => i.Key == ListKey(key))) continue;
            items.Add(new(ListKey(key), Lists, ListRules.TitleOf(key, meta), "A list of the organization's own", true));
        }
        var numbered = await NumberedListsAsync(db, cancellationToken);
        return items.Select(item =>
        {
            var row = rows.FirstOrDefault(r => r.Key == Prefix + item.Key);
            var locked = item.Key.StartsWith("LIST:") && numbered.Contains(item.Key[5..]) ? "A number part reads it: it follows the numbering" : null;
            var free = locked is null && (row?.Value is { } value ? value == Free : item.FreeByDefault);
            return new LibertyView(item.Key, item.Area, item.Title, item.Why, free, item.FreeByDefault,
                row?.UpdatedAt.ToDateTimeOffset(), row?.UpdatedByName, locked);
        }).ToList();
    }

    /// <summary>
    /// Whether a project may change this setting. A list a number part reads follows the numbering, whatever its switch.
    /// </summary>
    public static async Task<bool> IsFreeAsync(DeliosDbContext db, string key, CancellationToken cancellationToken)
    {
        if (key.StartsWith("LIST:") && (await NumberedListsAsync(db, cancellationToken)).Contains(key[5..]))
            return await IsFreeAsync(db, Numbering, cancellationToken);
        var value = await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == null && s.Key == Prefix + key)
            .Select(s => s.Value).FirstOrDefaultAsync(cancellationToken);
        return value is not null ? value == Free : Items.FirstOrDefault(i => i.Key == key)?.FreeByDefault ?? true;
    }

    /// <summary>The acts of "who carries each act out", stored one setting each (with <c>SKIP:</c> and <c>CONFIRM:</c> beside them).</summary>
    private static readonly HashSet<string> Acts =
        ["REVIEW_ISSUE", "RETURN_OUTCOME", "ISSUE", "DELEGATE", "AUTHORIZE_REVISION", "WITHDRAW", "ACTION_NOTE", "ACTION_LINKS", "PROJECT_PEOPLE", "VOID", "__ALL__"];

    /// <summary>The Control room answer a project's setting belongs to (its switch), or none for a setting no switch covers.</summary>
    public static string? RoomItemOf(string settingKey) => settingKey switch
    {
        _ when Acts.Contains(settingKey) || settingKey.StartsWith("SKIP:") || settingKey.StartsWith("CONFIRM:") => "WHO_DOES_WHAT",
        "POLICY_RELEASE" or "POLICY_READY" or "POLICY_MATRIX" or "POLICY_MATRIX_DETAIL" or "ESCALATE_AFTER_DAYS" => settingKey,
        "POLICY_PDF_STAMP" or "STAMP_COMMENTS" or "STAMP_PLACE" or "STAMP_NOTE" => "POLICY_PDF_STAMP",
        "SUPPLIER_INTAKE" or "AS_RECEIVED_FILING" => "SUPPLIER_INTAKE",
        _ when settingKey.StartsWith("STAMP:") || settingKey.StartsWith("STAMP_SHOW:") => "POLICY_PDF_STAMP",
        _ => null,
    };

    /// <summary>
    /// Refuses a project's change of a Control room answer the organization keeps fixed (ROOM_FIXED), unless the answer
    /// is the organization's own default for new projects (putting the project back on it is always allowed).
    /// </summary>
    public static async Task<IResult?> RoomRefusalAsync(DeliosDbContext db, string settingKey, string? value, CancellationToken cancellationToken)
    {
        if (RoomItemOf(settingKey) is not { } item || await IsFreeAsync(db, item, cancellationToken)) return null;
        var defaults = await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == null && s.Key == "PROJECT_DEFAULTS")
            .Select(s => s.Value).FirstOrDefaultAsync(cancellationToken);
        string? standard = null;
        try
        {
            if (defaults is not null && System.Text.Json.JsonDocument.Parse(defaults).RootElement.TryGetProperty("values", out var values)
                && values.TryGetProperty(settingKey, out var one)) standard = one.GetString();
        }
        catch (System.Text.Json.JsonException) { }
        // The stamp is a card of its own: the organization's answer is the default every project reads.
        if (item == "POLICY_PDF_STAMP")
            standard = await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == null && s.Key == settingKey)
                .Select(s => s.Value).FirstOrDefaultAsync(cancellationToken);
        var asked = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        if (asked == standard) return null;
        if (item == "POLICY_PDF_STAMP")
            return Problems.Forbidden("ROOM_FIXED", "The stamp: the organization keeps it the same on every project. An administrator changes it in the organization's Settings (The stamp).");
        var title = Items.FirstOrDefault(i => i.Key == item)?.Title ?? item;
        return Problems.Forbidden("ROOM_FIXED",
            $"{title}: the organization keeps it the same on every project. An administrator changes it in the organization's Settings (Defaults for new projects).");
    }

    /// <summary>The lists a part of a numbering scheme reads (<c>LIST:&lt;key&gt;</c>, and the app's lists numbering reads).</summary>
    private static async Task<HashSet<string>> NumberedListsAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var schemes = await db.NumberingSchemes.AsNoTracking().Where(s => s.ProjectId == null && s.Active).ToListAsync(cancellationToken);
        return schemes.SelectMany(s => s.Fields)
            .Where(f => f.Source.StartsWith(FieldSources.ListPrefix, StringComparison.Ordinal))
            .Select(f => f.Source[FieldSources.ListPrefix.Length..]).ToHashSet();
    }

    /// <summary>Body of moving one switch.</summary>
    public sealed record LibertyRequest(bool Free);

    /// <summary>
    /// <c>GET /api/liberty</c>: every switch, read by everyone of ours (a project's pages say what is the organization's);
    /// <c>PUT /api/liberty/{key}</c>: an administrator moves one. Moving it never changes a project's copy already made.
    /// </summary>
    public static void MapLibertyEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/liberty").WithTags("Settings").RequireAuthorization().AddEndpointFilter<TransactionFilter>();
        group.MapGet("", async (DeliosDbContext db, CancellationToken c) => Results.Ok(await ReadAsync(db, c)));
        group.MapPut("/{key}", async (string key, LibertyRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
            CancellationToken c) =>
        {
            if (!await Keepers.ConfiguresAsync(http)) return Problems.Forbidden("ADMIN_ONLY", "An administrator decides what projects may change.");
            var item = (await ReadAsync(db, c)).FirstOrDefault(i => i.Key == key);
            if (item is null) return Problems.NotFound("SWITCH_NOT_FOUND", "No such setting.");
            if (item.Locked is { } why) return Problems.Invalid("LIBERTY_LOCKED", $"{item.Title}: {why}.");
            if (item.Free == request.Free) return Results.NoContent();
            var me = await db.Users.AsNoTracking().SingleAsync(u => u.Id == http.User.UserId(), c);
            var row = await db.Set<Setting>().SingleOrDefaultAsync(s => s.ProjectId == null && s.Key == Prefix + key, c);
            var value = request.Free ? Free : Fixed;
            if (row is null)
                db.Add(new Setting { TenantId = http.User.TenantId(), Key = Prefix + key, Value = value, UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = me.Name });
            else
            {
                row.Value = value;
                row.UpdatedAt = clock.GetCurrentInstant();
                row.UpdatedByName = me.Name;
            }
            await db.SaveChangesAsync(c);
            await audit.WriteAsync(new Actor(me.Id, me.Name), "LIBERTY_CHANGED", "Setting", null, item.Title,
                request.Free ? "Fixed → Free" : "Free → Fixed", cancellationToken: c);
            return Results.NoContent();
        });
    }
}
