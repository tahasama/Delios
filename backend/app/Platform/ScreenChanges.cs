using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Options;

namespace Delios.Host.Platform;

/// <summary>
/// What the screens keep, and what clears it (owner: "whatever and whenever an activity happens, it triggers whatever
/// needs to be updated, partially"). The screens keep the backend's answers under labels (Next.js `cacheTag`); every
/// save here names the labels it touched, by project and area, and a document by its own label. A change asked by a
/// screen comes back on its answer (header <see cref="Header"/>), so the screen clears them at once; any other change
/// (the worker, another organization's DELIOS, a reply by email) is posted to the screens' own clearing route
/// (<see cref="ScreensNotifier"/>). Nothing is swept: a label is read again only after a change named it.
/// </summary>
public sealed class ScreenChanges
{
    /// <summary>The answer's header carrying the labels a screen's own act changed.</summary>
    public const string Header = "X-Delios-Changed";
    /// <summary>Sent by the screens on every call: they read <see cref="Header"/>.</summary>
    public const string FromScreens = "X-Delios-Screens";

    /// <summary>Everything the screens keep, cleared by a change to how things work (settings, people, rights, lists).</summary>
    public const string All = "all";

    private readonly HashSet<string> tags = [];
    public IReadOnlyCollection<string> Tags => tags;
    /// <summary>The organizations whose register changed, for the search index (<see cref="Search.SearchSignal"/>).</summary>
    public HashSet<Guid> SearchTenants { get; } = [];
    internal bool HeaderPlanned { get; set; }
    /// <summary>Every label this request's saves changed, for its answer's header.</summary>
    internal HashSet<string>? Answered { get; set; }
    /// <summary>The organizations whose way of working changed: their kept access is left unused once committed (<see cref="AccessVersions"/>).</summary>
    internal HashSet<Guid> AccessTenants { get; } = [];
    /// <summary>A save put a message in the outbox: the relay is woken once it is committed.</summary>
    internal bool Outbox { get; set; }
    /// <summary>What moved notice days, per organization, sent with the save (<see cref="Actions.NoticesMoved"/>).</summary>
    internal Dictionary<Guid, NoticeMoves> Moves { get; } = [];
    /// <summary>The projects, per organization, whose packages a change may move (<see cref="Packages.PackagesMoved"/>).</summary>
    internal Dictionary<Guid, HashSet<Guid>> PackageMoves { get; } = [];

    /// <summary>A project's area changed (plan, docs, reviews, transmittals, packages, assets, checks).</summary>
    public void Area(Guid? projectId, string area)
    {
        if (area == All) { tags.Add(All); return; }
        tags.Add(projectId is { } p ? $"p:{p}:{area}" : $"area:{area}");
    }

    /// <summary>One document changed: its page, and the lists that show it.</summary>
    public void Document(Guid? projectId, Guid documentId)
    {
        tags.Add($"doc:{documentId}");
        Area(projectId, Areas.Docs);
    }

    internal void Clear()
    {
        tags.Clear();
        SearchTenants.Clear();
        AccessTenants.Clear();
        Outbox = false;
    }
}

/// <summary>What one save changed that moves an organization's notice days.</summary>
internal sealed class NoticeMoves
{
    public HashSet<Guid> Projects { get; } = [];
    public bool Organization { get; set; }
    public HashSet<Guid> Activities { get; } = [];
    public HashSet<Guid> Steps { get; } = [];
    public HashSet<Guid> Reviews { get; } = [];
}

/// <summary>The areas a kept answer depends on, the same names as the screens' (`lib/core/kept.ts`).</summary>
public static class Areas
{
    public const string Plan = "plan", Docs = "docs", Reviews = "reviews", Transmittals = "transmittals", Packages = "packages",
        Assets = "assets", Checks = "checks", Reports = "reports";
}

/// <summary>
/// Watches every save: from the rows added, changed or removed, the labels they touch. A row naming its project
/// (or reaching it through the review, transmittal, package, action or revision it belongs to) clears that project's
/// area only; one that cannot, that area on every project; a change to how things work clears everything. What it
/// changed is told once it is committed (<see cref="ScreenChangeCommits"/>), never before: the screens, the search
/// index and the outbox's relay. A change to the schedule, a review step or how days are counted sends, with the save
/// itself, the notice days it moved (<see cref="Actions.NoticesMoved"/>).
/// </summary>
public sealed class ScreenChangeWatcher(ScreenChanges changes, ScreensNotifier notifier, IHttpContextAccessor accessor,
    Search.SearchSignal search, Messaging.OutboxWake outbox, AccessVersions access) : SaveChangesInterceptor
{
    /// <summary>Rows the screens never show as such: their saving clears nothing.</summary>
    private static readonly HashSet<string> Silent =
    [
        "AuditEvent", "OutboxMessage", "Session", "Notification", "EmailMessage", "PushSubscription", "SearchWatermark",
        "DocumentSnapshot", "IdempotencyRecord", "PersonSeen", "RevisionFact", "TransmittalFact", "DocumentFact", "ValueUsed", "FileText", "DataProtectionKey", "Notice", "NoticeAlarm",
    ];

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (eventData.Context is { } context) Collect(context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        if (eventData.Context is { } context) Collect(context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
    {
        Flush(eventData.Context);
        return base.SavedChangesAsync(eventData, result, cancellationToken);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        Flush(eventData.Context);
        return base.SavedChanges(eventData, result);
    }

    private void Collect(DbContext context)
    {
        foreach (var entry in context.ChangeTracker.Entries().ToList())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted)) continue;
            var type = entry.Metadata.ClrType;
            if (type.Name == "OutboxMessage") changes.Outbox = true;
            if (Silent.Contains(type.Name) || Bookkeeping(entry)) continue;
            // A document, or the project that says how its text is read, changed: the search index is told.
            if (type.Name is "Document" or "Project" && Guid(entry, "TenantId") is { } tenant) changes.SearchTenants.Add(tenant);
            Moves(entry, type);
            MovesPackages(entry, type);
            Mark(entry, type);
        }
        // What a package's rule admits, or its tree hands down, is worked out after the save that may move it.
        foreach (var (tenantId, projects) in changes.PackageMoves)
        {
            context.Add(new Messaging.OutboxMessage
            {
                RoutingKey = Packages.PackagesMoved.RoutingKey,
                Payload = System.Text.Json.JsonSerializer.Serialize(new Packages.PackagesMoved(tenantId, [.. projects])),
            });
            changes.Outbox = true;
        }
        changes.PackageMoves.Clear();
        // The notice days moved go with the save itself: committed with it, or not at all.
        foreach (var (tenantId, moves) in changes.Moves)
        {
            context.Add(new Messaging.OutboxMessage
            {
                RoutingKey = Actions.NoticesMoved.RoutingKey,
                Payload = System.Text.Json.JsonSerializer.Serialize(new Actions.NoticesMoved(tenantId, [.. moves.Projects], moves.Organization,
                    [.. moves.Activities], [.. moves.Steps], [.. moves.Reviews])),
            });
            changes.Outbox = true;
        }
        changes.Moves.Clear();
    }

    /// <summary>What moves notice days: an action and what hangs from it, a review and its steps, how days are counted.</summary>
    private void Moves(EntityEntry entry, Type type)
    {
        if (Guid(entry, "TenantId") is not { } tenantId) return;
        NoticeMoves Of() => changes.Moves.TryGetValue(tenantId, out var m) ? m : changes.Moves[tenantId] = new NoticeMoves();
        switch (type.Namespace, type.Name)
        {
            case ("Delios.Host.Actions", "Activity"):
                if (Guid(entry, "Id") is { } activity) Of().Activities.Add(activity);
                break;
            // What hangs from an action: its documents, confirmations, decisions.
            case ("Delios.Host.Actions" or "Delios.Host.Records", _) when Guid(entry, "ActivityId") is { } activityId:
                Of().Activities.Add(activityId);
                break;
            case ("Delios.Host.Reviews", "Review"):
                if (Guid(entry, "Id") is { } review) Of().Reviews.Add(review);
                break;
            case ("Delios.Host.Reviews", "ReviewStep"):
                if (Guid(entry, "Id") is { } step) Of().Steps.Add(step);
                break;
            case ("Delios.Host.Reviews", "ReviewParticipant") when Guid(entry, "StepId") is { } stepId:
                Of().Steps.Add(stepId);
                break;
            case ("Delios.Host.Settings", "Setting" or "DayOff"):
                if (Guid(entry, "ProjectId") is { } own) Of().Projects.Add(own);
                else Of().Organization = true;
                break;
            case ("Delios.Host.Identity", "Project"):
                if (Guid(entry, "Id") is { } project) Of().Projects.Add(project);
                break;
        }
    }

    /// <summary>
    /// What may move a package (owner: worked out when a document or a package changes, never when a list opens): a
    /// document registered, or changed in what a rule reads (its types, discipline, originator, order, state); a tag
    /// linked or unlinked; a package made, or changed in its rule, its place or its state. The packages' own work
    /// (members taken in, handed down) sends nothing again.
    /// </summary>
    private void MovesPackages(EntityEntry entry, Type type)
    {
        var moves = (type.Namespace, type.Name) switch
        {
            ("Delios.Host.Documents", "Document") => entry.State == EntityState.Added || Changed(entry, RuleReads),
            ("Delios.Host.Records", "DocumentAsset") => entry.State != EntityState.Modified,
            ("Delios.Host.Packages", "Package") => entry.State == EntityState.Added || Changed(entry, PackageMoves)
                || entry.References.Any(r => r.TargetEntry is { State: EntityState.Added or EntityState.Modified or EntityState.Deleted }),
            _ => false,
        };
        if (!moves || Guid(entry, "TenantId") is not { } tenantId || Guid(entry, "ProjectId") is not { } projectId) return;
        (changes.PackageMoves.TryGetValue(tenantId, out var set) ? set : changes.PackageMoves[tenantId] = []).Add(projectId);
    }

    private static readonly HashSet<string> RuleReads = ["DeliverableType", "DocType", "Discipline", "Originator", "ContractRef", "State"];
    private static readonly HashSet<string> PackageMoves = ["ParentId", "State", "RuleCeasedAt"];

    private static bool Changed(EntityEntry entry, HashSet<string> names) =>
        entry.State == EntityState.Modified && entry.Properties.Any(p => p.IsModified && names.Contains(p.Metadata.Name));

    /// <summary>
    /// A change only to what no screen shows as such (a failed sign-in counted, a lock): it clears nothing, or every
    /// wrong password typed anywhere would throw away every kept answer.
    /// </summary>
    private static bool Bookkeeping(EntityEntry entry) =>
        entry.State == EntityState.Modified && entry.Properties.Where(p => p.IsModified).All(p => Unshown.Contains(p.Metadata.Name));

    private static readonly HashSet<string> Unshown = ["FailedSignIns", "LockedUntil"];

    private void Mark(EntityEntry entry, Type type)
    {
        var area = AreaOf(type);
        if (area is null) return;
        var projectId = ProjectOf(entry);
        if (area == ScreenChanges.All)
        {
            changes.Area(projectId, ScreenChanges.All);
            if (Guid(entry, "TenantId") is { } tenantId) changes.AccessTenants.Add(tenantId);
            return;
        }
        changes.Area(projectId, area);
        if (Guid(entry, "DocumentId") is { } documentId) changes.Document(projectId, documentId);
        else if (type.Name == "Document" && Guid(entry, "Id") is { } id) changes.Document(projectId, id);
        // What a change moves beyond its own area: a document's state shows on the plan, its packages and Home.
        foreach (var also in Beyond(area)) changes.Area(projectId, also);
        // What hangs from an action, wherever it is kept (a discipline's confirmation is a record): the plan shows it.
        if (area != Areas.Plan && Guid(entry, "ActivityId") is not null) changes.Area(projectId, Areas.Plan);
    }

    /// <summary>The area a kind of row belongs to, by the part of the app it lives in.</summary>
    private static string? AreaOf(Type type) => type.Namespace switch
    {
        "Delios.Host.Actions" => Areas.Plan,
        "Delios.Host.Reviews" => Areas.Reviews,
        "Delios.Host.Transmittals" => Areas.Transmittals,
        "Delios.Host.Packages" => Areas.Packages,
        "Delios.Host.Records" => Areas.Assets,
        "Delios.Host.Checks" => Areas.Checks,
        // A report counted again: only the reports' kept answers (owner: a report is refreshed by hand only).
        "Delios.Host.Reports" => Areas.Reports,
        "Delios.Host.Documents" when type.Name is "Document" or "Revision" or "StoredFile" or "DocumentAccess" or "NumberEquivalent"
            or "SubmissionRecord" or "HandBack" => Areas.Docs,
        "Delios.Host.Notifications" or "Delios.Host.Audit" or "Delios.Host.Messaging" or "Delios.Host.Search" or "Delios.Host.Extraction" => null,
        // Lists, numbering, settings, people, functions, organizations, projects: how everything reads.
        _ => ScreenChanges.All,
    };

    private static IEnumerable<string> Beyond(string area) => area switch
    {
        Areas.Docs => [Areas.Plan, Areas.Packages],
        Areas.Reviews => [Areas.Docs, Areas.Plan],
        Areas.Transmittals => [Areas.Docs, Areas.Plan, Areas.Packages],
        Areas.Packages => [Areas.Docs],
        _ => [],
    };

    /// <summary>The project a row belongs to: its own, or that of the row it hangs from, when loaded.</summary>
    private static Guid? ProjectOf(EntityEntry entry)
    {
        if (Guid(entry, "ProjectId") is { } own) return own;
        foreach (var (key, parent) in Parents)
            if (Guid(entry, key) is { } parentId && entry.Context.ChangeTracker.Entries()
                    .FirstOrDefault(e => e.Metadata.ClrType.Name == parent && Guid(e, "Id") == parentId) is { } found)
                return ProjectOf(found);
        return null;
    }

    private static readonly (string Key, string Parent)[] Parents =
        [("ReviewId", "Review"), ("StepId", "ReviewStep"), ("TransmittalId", "Transmittal"), ("PackageId", "Package"),
         ("ActivityId", "Activity"), ("RevisionId", "Revision"), ("DocumentId", "Document")];

    private static Guid? Guid(EntityEntry entry, string name)
    {
        var property = entry.Metadata.FindProperty(name);
        if (property is null) return null;
        var value = entry.State == EntityState.Deleted ? entry.OriginalValues[property] : entry.CurrentValues[property];
        return value is System.Guid id && id != System.Guid.Empty ? id : null;
    }

    /// <summary>
    /// After a save: a screen's own act carries the labels back on its answer, cleared by the screen at once
    /// (read-your-own-writes). The rest waits for the commit (<see cref="Release"/>); a save outside a transaction is
    /// committed already.
    /// </summary>
    private void Flush(DbContext? context)
    {
        PlanHeader();
        if (context?.Database.CurrentTransaction is null) Release();
    }

    /// <summary>
    /// Once committed: every change is posted to the screens, for every other session and for a change no screen asked for
    /// (the worker, another way in); the search index is told; the outbox's relay woken. Cleared twice costs nothing.
    /// </summary>
    internal void Release()
    {
        if (changes.SearchTenants.Count > 0) search.Publish(changes.SearchTenants);
        if (changes.AccessTenants.Count > 0) access.Raise(changes.AccessTenants);
        if (changes.Outbox) outbox.Ring();
        if (changes.Tags.Count > 0) notifier.Post([.. changes.Tags]);
        changes.Clear();
    }

    /// <summary>Rolled back: nothing happened, nothing is told.</summary>
    internal void Discard() => changes.Clear();

    private void PlanHeader()
    {
        if (changes.Tags.Count == 0) return;
        var http = accessor.HttpContext;
        if (http is not null && http.Request.Headers.ContainsKey(ScreenChanges.FromScreens) && !HttpMethods.IsGet(http.Request.Method)
            && !http.Response.HasStarted && !changes.HeaderPlanned)
        {
            changes.HeaderPlanned = true;
            var answered = new HashSet<string>();
            changes.Answered = answered;
            http.Response.OnStarting(() =>
            {
                if (answered.Count > 0) http.Response.Headers[ScreenChanges.Header] = string.Join(',', answered);
                return Task.CompletedTask;
            });
        }
        changes.Answered?.UnionWith(changes.Tags);
    }
}

/// <summary>Tells what the saves of a transaction changed once it is committed, and nothing once it is rolled back.</summary>
public sealed class ScreenChangeCommits(ScreenChangeWatcher watcher) : DbTransactionInterceptor
{
    public override void TransactionCommitted(System.Data.Common.DbTransaction transaction, TransactionEndEventData eventData) => watcher.Release();

    public override Task TransactionCommittedAsync(System.Data.Common.DbTransaction transaction, TransactionEndEventData eventData,
        CancellationToken cancellationToken = default)
    {
        watcher.Release();
        return Task.CompletedTask;
    }

    public override void TransactionRolledBack(System.Data.Common.DbTransaction transaction, TransactionEndEventData eventData) => watcher.Discard();

    public override Task TransactionRolledBackAsync(System.Data.Common.DbTransaction transaction, TransactionEndEventData eventData,
        CancellationToken cancellationToken = default)
    {
        watcher.Discard();
        return Task.CompletedTask;
    }
}

/// <summary>Where the screens' clearing route is (<c>Screens:Url</c>, the web container), and the secret it asks.</summary>
public sealed class ScreensOptions
{
    public const string Section = "Screens";
    /// <summary>
    /// The Redis database the screens keep their answers in (frontend/cache-handler.mjs, SCREENS_CACHE_REDIS): each
    /// label changed is written there too, with when, so nothing is missed while the screens restart. Null: not written.
    /// </summary>
    public int? CacheDb { get; set; }
    /// <summary>The screens' own address on the internal network (http://web:3000); empty: nothing is posted.</summary>
    public string? Url { get; set; }
    public string? Secret { get; set; }
}

/// <summary>
/// Posts the labels changed outside a screen's act to the screens' clearing route (`/api/screens/changed`), a moment
/// later and gathered, so a burst of saves is one call; and writes them, with when, where the screens keep their answers
/// (Redis), so a change is never missed while the screens are down.
/// </summary>
public sealed class ScreensNotifier(IHttpClientFactory clients, IOptions<ScreensOptions> options, IServiceProvider services,
    ILogger<ScreensNotifier> logger) : BackgroundService
{
    private readonly Channel<string[]> queue = Channel.CreateUnbounded<string[]>();

    public void Post(string[] tags)
    {
        if ((!string.IsNullOrWhiteSpace(options.Value.Url) || options.Value.CacheDb is not null) && tags.Length > 0) queue.Writer.TryWrite(tags);
    }

    /// <summary>The labels changed, with when, where the screens keep their answers: read there before any kept answer is used.</summary>
    private void Mark(HashSet<string> tags)
    {
        if (options.Value.CacheDb is not { } index) return;
        try
        {
            if (services.GetService<StackExchange.Redis.IConnectionMultiplexer>() is not { IsConnected: true } redis) return;
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
            redis.GetDatabase(index).HashSet("next:tags", [.. tags.Select(t => new StackExchange.Redis.HashEntry(t, now))]);
        }
        catch (Exception e)
        {
            logger.LogWarning(e, "Writing the changed labels where the screens keep their answers failed");
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (await queue.Reader.WaitToReadAsync(stoppingToken))
        {
            // Gathered for a quarter of a second: a burst of saves is one call.
            await Task.Delay(250, stoppingToken);
            var tags = new HashSet<string>();
            while (queue.Reader.TryRead(out var some)) tags.UnionWith(some);
            if (tags.Count == 0) continue;
            Mark(tags);
            if (string.IsNullOrWhiteSpace(options.Value.Url)) continue;
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, $"{options.Value.Url!.TrimEnd('/')}/api/screens/changed")
                {
                    Content = JsonContent.Create(new { tags }),
                };
                if (!string.IsNullOrEmpty(options.Value.Secret)) request.Headers.Add("X-Delios-Screens-Secret", options.Value.Secret);
                using var response = await clients.CreateClient(nameof(ScreensNotifier)).SendAsync(request, stoppingToken);
                if (!response.IsSuccessStatusCode) logger.LogWarning("The screens refused the changed labels: {Status}", (int)response.StatusCode);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogWarning(e, "Telling the screens what changed failed; the labels written in Redis still say it");
            }
        }
    }
}
