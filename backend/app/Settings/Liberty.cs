using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Notifications;
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

/// <summary>
/// A switch as the screens read it: where it stands, whether it was moved, when it cannot be moved, and the projects it
/// leaves free although it is fixed (<see cref="Except"/>). Read for one project, <see cref="Free"/> says whether that
/// project may change it, and <see cref="ExceptHere"/> that it may only by an exception.
/// </summary>
public sealed record LibertyView(string Key, string Area, string Title, string Why, bool Free, bool FreeByDefault,
    DateTimeOffset? ChangedAt, string? ChangedBy, string? Locked, IReadOnlyList<LibertyExceptionView> Except, bool ExceptHere);

/// <summary>One project a fixed switch leaves free (owner: "Fixed, except on these projects"): who decided it, when and why.</summary>
public sealed record LibertyExceptionView(Guid ProjectId, string ProjectCode, string ProjectName, string Reason, DateTimeOffset At, string By);

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
    /// <summary>The projects a fixed switch leaves free, kept as <c>LIBERTY_EXCEPT:{Key}</c> in the organization's settings (a list).</summary>
    public const string ExceptPrefix = "LIBERTY_EXCEPT:";
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

        new(Calendar.Switch, "Calendar", "Its own days off", "A site has its own shutdowns and local holidays; due days skip them, the organization's holidays always count", true),
        new(Forms, "Forms & fields", "Forms & fields", "A client may ask fields of its own; a field a number part reads follows the numbering", true),
        new(Routes, "Review routes", "Review routes", "Each project has its own reviewers and steps", true),
        new(Functions, "Functions & permissions", "Functions & permissions", "Each project's team shares out the work its own way; the administrators' function stays the organization's", true),

        new("WHO_DOES_WHAT", Room, "Who carries each act out, and what is confirmed", "The project's contract and team", true),
        new("POLICY_RELEASE", Room, "What releasing a revision means", "The project's contract", true),
        new("POLICY_PDF_STAMP", Stamp, "The stamp", "What the project's client asks of the PDFs it receives", true),
        new("POLICY_READY", Room, "When an action has what it needs", "The project's way of planning", true),
        new("POLICY_MATRIX", Room, "Who may be put on a review", "The project's team", true),
        new("POLICY_MATRIX_DETAIL", Room, "How fine the distribution matrix is cut", "The project's team", true),
        new("LEAD_DAYS", Room, "Days a document is needed before an action", "The project's way of planning", true),
        new("RISK_WINDOW", Room, "The risk window", "The project's way of planning", true),
        new("ESCALATE_AFTER_DAYS", Room, "Days before a silent discipline is notified again", "The project's way of planning", true),
        new("SUPPLIER_INTAKE", Room, "How other organizations' documents come in: by placeholder, or as they come", "The project's contract with its suppliers", true),
    ];

    /// <summary>
    /// Every switch, the organization's own lists included, as it stands; read for one project (<paramref name="projectId"/>),
    /// a fixed switch that project is an exception to reads free.
    /// </summary>
    public static async Task<List<LibertyView>> ReadAsync(DeliosDbContext db, Guid? projectId, CancellationToken cancellationToken)
    {
        var rows = await db.Set<Setting>().AsNoTracking()
            .Where(s => s.ProjectId == null && (s.Key.StartsWith(Prefix) || s.Key.StartsWith(ExceptPrefix) || s.Key.StartsWith("SET:")))
            .ToListAsync(cancellationToken);
        var exceptions = rows.Where(r => r.Key.StartsWith(ExceptPrefix)).ToDictionary(r => r.Key[ExceptPrefix.Length..], r => ReadExceptions(r.Value));
        var ids = exceptions.Values.SelectMany(e => e.Select(one => one.ProjectId)).Distinct().ToList();
        var projects = await db.Projects.AsNoTracking().Where(p => ids.Contains(p.Id)).Select(p => new { p.Id, p.Code, p.Name }).ToListAsync(cancellationToken);
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
        var views = items.Select(item =>
        {
            var row = rows.FirstOrDefault(r => r.Key == Prefix + item.Key);
            var locked = item.Key.StartsWith("LIST:") && numbered.Contains(item.Key[5..]) ? "A number part reads it: it follows the numbering" : null;
            var free = locked is null && (row?.Value is { } value ? value == Free : item.FreeByDefault);
            // Exceptions count only while the switch is fixed; a project gone stays out of the list.
            var except = locked is null && !free
                ? exceptions.GetValueOrDefault(item.Key, []).Join(projects, e => e.ProjectId, p => p.Id,
                    (e, p) => new LibertyExceptionView(p.Id, p.Code, p.Name, e.Reason, e.At, e.By)).OrderBy(e => e.ProjectCode).ToList()
                : [];
            var here = projectId is { } id && except.Any(e => e.ProjectId == id);
            return new LibertyView(item.Key, item.Area, item.Title, item.Why, free || here, item.FreeByDefault,
                row?.UpdatedAt.ToDateTimeOffset(), row?.UpdatedByName, locked, except, here);
        }).ToList();
        // A list a number part reads follows the numbering, its exceptions included.
        var numbering = views.First(v => v.Key == Numbering);
        return views.Select(v => v.Locked is null ? v : v with { Free = numbering.Free, ExceptHere = numbering.ExceptHere }).ToList();
    }

    /// <summary>One project left free by a fixed switch, as kept.</summary>
    public sealed record LibertyException(Guid ProjectId, string Reason, DateTimeOffset At, string By);

    private static List<LibertyException> ReadExceptions(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return [];
        try { return System.Text.Json.JsonSerializer.Deserialize<List<LibertyException>>(value, Json) ?? []; }
        catch (System.Text.Json.JsonException) { return []; }
    }

    private static readonly System.Text.Json.JsonSerializerOptions Json = new(System.Text.Json.JsonSerializerDefaults.Web);

    /// <summary>
    /// Whether a project may change this setting: its switch is free, or fixed with this project as an exception. A list a
    /// number part reads follows the numbering, whatever its switch.
    /// </summary>
    public static async Task<bool> IsFreeAsync(DeliosDbContext db, string key, Guid projectId, CancellationToken cancellationToken)
    {
        if (key.StartsWith("LIST:") && (await NumberedListsAsync(db, cancellationToken)).Contains(key[5..]))
            return await IsFreeAsync(db, Numbering, projectId, cancellationToken);
        return await SwitchFreeAsync(db, key, cancellationToken) || await ExceptedAsync(db, key, projectId, cancellationToken) is not null;
    }

    /// <summary>
    /// The exception that leaves this project free to change a setting the organization keeps fixed (who, when, why),
    /// or none: the switch is free, or the project is not an exception. The project's pages say it with its reason.
    /// </summary>
    public static async Task<LibertyException?> ExceptionHereAsync(DeliosDbContext db, string key, Guid projectId, CancellationToken cancellationToken)
    {
        if (key.StartsWith("LIST:") && (await NumberedListsAsync(db, cancellationToken)).Contains(key[5..]))
            return await ExceptionHereAsync(db, Numbering, projectId, cancellationToken);
        return await SwitchFreeAsync(db, key, cancellationToken) ? null : await ExceptedAsync(db, key, projectId, cancellationToken);
    }

    private static async Task<bool> SwitchFreeAsync(DeliosDbContext db, string key, CancellationToken cancellationToken)
    {
        var value = await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == null && s.Key == Prefix + key)
            .Select(s => s.Value).FirstOrDefaultAsync(cancellationToken);
        return value is not null ? value == Free : Items.FirstOrDefault(i => i.Key == key)?.FreeByDefault ?? true;
    }

    private static async Task<LibertyException?> ExceptedAsync(DeliosDbContext db, string key, Guid projectId, CancellationToken cancellationToken)
    {
        var except = await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == null && s.Key == ExceptPrefix + key)
            .Select(s => s.Value).FirstOrDefaultAsync(cancellationToken);
        return ReadExceptions(except).FirstOrDefault(e => e.ProjectId == projectId);
    }

    /// <summary>The acts of "who carries each act out", stored one setting each (with <c>SKIP:</c> and <c>CONFIRM:</c> beside them).</summary>
    private static readonly HashSet<string> Acts =
        ["REVIEW_ISSUE", "RETURN_OUTCOME", "ISSUE", "DELEGATE", "AUTHORIZE_REVISION", "WITHDRAW", "ACTION_NOTE", "ACTION_LINKS", "PROJECT_PEOPLE", "VOID", "__ALL__"];

    /// <summary>The Control room answer a project's setting belongs to (its switch), or none for a setting no switch covers.</summary>
    public static string? RoomItemOf(string settingKey) => settingKey switch
    {
        _ when Acts.Contains(settingKey) || settingKey.StartsWith("SKIP:") || settingKey.StartsWith("CONFIRM:") => "WHO_DOES_WHAT",
        "POLICY_RELEASE" or "POLICY_READY" or "POLICY_MATRIX" or "POLICY_MATRIX_DETAIL" or "ESCALATE_AFTER_DAYS" => settingKey,
        "POLICY_PDF_STAMP" or "STAMP_COMMENTS" or "STAMP_PLACE" or "STAMP_NOTE" or "STAMP_SIZE" => "POLICY_PDF_STAMP",
        "SUPPLIER_INTAKE" or "AS_RECEIVED_FILING" => "SUPPLIER_INTAKE",
        _ when settingKey.StartsWith("STAMP:") || settingKey.StartsWith("STAMP_SHOW:") => "POLICY_PDF_STAMP",
        _ => null,
    };

    /// <summary>
    /// Refuses a project's change of a Control room answer the organization keeps fixed (ROOM_FIXED), unless the answer
    /// is the organization's own default for new projects (putting the project back on it is always allowed).
    /// </summary>
    public static async Task<IResult?> RoomRefusalAsync(DeliosDbContext db, string settingKey, string? value, Guid projectId, CancellationToken cancellationToken)
    {
        if (RoomItemOf(settingKey) is not { } item || await IsFreeAsync(db, item, projectId, cancellationToken)) return null;
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
            $"{title}: the organization keeps it the same on every project. An administrator changes it in the organization's Settings (Control room).");
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

    /// <summary>Body of making a project an exception to a fixed switch, or ending it: always with why.</summary>
    public sealed record ExceptionRequest(Guid ProjectId, bool Except, string? Reason);

    /// <summary>Where a project changes what a switch covers, for the notice sent to its control function.</summary>
    private static string PageOf(string area) => area switch
    {
        "Numbering" => "/settings/numbering",
        "Revisions" => "/settings/revisions",
        Lists => "/settings/config",
        "Forms & fields" => "/settings/fields",
        "Review routes" => "/settings/workflow-templates",
        "Functions & permissions" => "/settings/functions",
        Stamp => "/settings/stamp",
        _ => "/settings/flow",
    };

    /// <summary>
    /// <c>GET /api/liberty</c>: every switch, read by everyone of ours (a project's pages say what is the organization's);
    /// <c>PUT /api/liberty/{key}</c>: an administrator moves one. Moving it never changes a project's copy already made.
    /// </summary>
    public static void MapLibertyEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/liberty").WithTags("Settings").RequireAuthorization().AddEndpointFilter<TransactionFilter>();
        group.MapGet("", async (Guid? projectId, HttpContext http, DeliosDbContext db, CancellationToken c) =>
        {
            var views = await ReadAsync(db, projectId, c);
            // Which projects are exceptions, and why, is an administrator's to read; anyone else reads only the
            // project they asked about.
            if (await Keepers.ConfiguresAsync(http)) return Results.Ok(views);
            return Results.Ok(views.Select(v => v with { Except = v.Except.Where(e => e.ProjectId == projectId).ToList() }));
        });
        group.MapPut("/{key}/except", ExceptAsync);
        group.MapPut("/{key}", async (string key, LibertyRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
            CancellationToken c) =>
        {
            if (!await Keepers.ConfiguresAsync(http)) return Problems.Forbidden("ADMIN_ONLY", "An administrator decides what projects may change.");
            var item = (await ReadAsync(db, null, c)).FirstOrDefault(i => i.Key == key);
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

    /// <summary>
    /// <c>PUT /api/liberty/{key}/except</c> (owner: "Fixed, except on these projects"): an administrator leaves one project
    /// free to change what a fixed switch covers, or ends that, always with why; logged (LIBERTY_EXCEPTION), the project's
    /// control function told. Ended, what the project already changed stays, as when a switch is made fixed later.
    /// </summary>
    private static async Task<IResult> ExceptAsync(string key, ExceptionRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        IClock clock, Notifier notifier, CancellationToken cancellationToken)
    {
        if (!await Keepers.ConfiguresAsync(http)) return Problems.Forbidden("ADMIN_ONLY", "An administrator decides what projects may change.");
        var reason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason.Trim();
        if (reason is null) return Problems.Invalid("REASON_REQUIRED", "Say why.", new { field = "reason" });
        var item = (await ReadAsync(db, null, cancellationToken)).FirstOrDefault(i => i.Key == key);
        if (item is null) return Problems.NotFound("SWITCH_NOT_FOUND", "No such setting.");
        if (item.Locked is { } why) return Problems.Invalid("LIBERTY_LOCKED", $"{item.Title}: {why}.");
        var project = await db.Projects.AsNoTracking().SingleOrDefaultAsync(p => p.Id == request.ProjectId, cancellationToken);
        if (project is null) return Problems.NotFound("PROJECT_NOT_FOUND", "No such project.");
        if (request.Except && item.Free)
            return Problems.Invalid("ALREADY_FREE", $"{item.Title} is free: every project may already change it.");
        var me = await db.Users.AsNoTracking().SingleAsync(u => u.Id == http.User.UserId(), cancellationToken);
        var row = await db.Set<Setting>().SingleOrDefaultAsync(s => s.ProjectId == null && s.Key == ExceptPrefix + key, cancellationToken);
        var list = ReadExceptions(row?.Value);
        var had = list.Any(e => e.ProjectId == project.Id);
        if (had == request.Except) return Results.NoContent();
        list.RemoveAll(e => e.ProjectId == project.Id);
        var now = clock.GetCurrentInstant();
        if (request.Except) list.Add(new LibertyException(project.Id, reason, now.ToDateTimeOffset(), me.Name));
        var value = System.Text.Json.JsonSerializer.Serialize(list, Json);
        if (row is null)
            db.Add(new Setting { TenantId = http.User.TenantId(), Key = ExceptPrefix + key, Value = value, UpdatedAt = now, UpdatedByName = me.Name });
        else
        {
            row.Value = value;
            row.UpdatedAt = now;
            row.UpdatedByName = me.Name;
        }
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(me.Id, me.Name), "LIBERTY_EXCEPTION", "Project", project.Id, $"{project.Code}: {item.Title}",
            request.Except ? $"Fixed, except on {project.Code}: {reason}" : $"No longer an exception: {reason}", project.Id, cancellationToken);
        await notifier.NotifyAsync(project.TenantId, project.Id, await Actions.NoticeLog.HoldersAsync(db, project.Id, Verbs.Control, cancellationToken),
            NotificationKinds.General,
            request.Except ? $"{project.Code} may change {item.Title}" : $"{project.Code} no longer changes {item.Title}",
            request.Except
                ? $"{me.Name} left {project.Code} free to change {item.Title}, which every other project takes as the organization's: {reason}."
                : $"{me.Name} ended {project.Code}'s exception on {item.Title}: {reason}. What the project already changed stays as it is; nothing more can be changed.",
            PageOf(item.Area), cancellationToken);
        return Results.NoContent();
    }
}
