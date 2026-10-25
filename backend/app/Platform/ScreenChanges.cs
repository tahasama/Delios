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

    internal void Clear() => tags.Clear();
}

/// <summary>The areas a kept answer depends on, the same names as the screens' (`lib/core/kept.ts`).</summary>
public static class Areas
{
    public const string Plan = "plan", Docs = "docs", Reviews = "reviews", Transmittals = "transmittals", Packages = "packages",
        Assets = "assets", Checks = "checks";
}

/// <summary>
/// Watches every save: from the rows added, changed or removed, the labels they touch. A row naming its project
/// (or reaching it through the review, transmittal, package, action or revision it belongs to) clears that project's
/// area only; one that cannot, that area on every project; a change to how things work clears everything.
/// </summary>
public sealed class ScreenChangeWatcher(ScreenChanges changes, ScreensNotifier notifier, IHttpContextAccessor accessor,
    Search.SearchSignal search) : SaveChangesInterceptor
{
    /// <summary>Rows the screens never show as such: their saving clears nothing.</summary>
    private static readonly HashSet<string> Silent =
    [
        "AuditEvent", "OutboxMessage", "Session", "Notification", "EmailMessage", "PushSubscription", "SearchWatermark",
        "DocumentSnapshot", "IdempotencyRecord", "FileText", "DataProtectionKey", "Notice",
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
        Flush();
        return base.SavedChangesAsync(eventData, result, cancellationToken);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        Flush();
        return base.SavedChanges(eventData, result);
    }

    private void Collect(DbContext context)
    {
        foreach (var entry in context.ChangeTracker.Entries())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted)) continue;
            var type = entry.Metadata.ClrType;
            if (Silent.Contains(type.Name)) continue;
            // A document, or the project that says how its text is read, changed: the search index is told.
            if (type.Name is "Document" or "Project" && Guid(entry, "TenantId") is { } tenant) changes.SearchTenants.Add(tenant);
            Mark(entry, type);
        }
    }

    private void Mark(EntityEntry entry, Type type)
    {
        var area = AreaOf(type);
        if (area is null) return;
        var projectId = ProjectOf(entry);
        if (area == ScreenChanges.All) { changes.Area(projectId, ScreenChanges.All); return; }
        changes.Area(projectId, area);
        if (Guid(entry, "DocumentId") is { } documentId) changes.Document(projectId, documentId);
        else if (type.Name == "Document" && Guid(entry, "Id") is { } id) changes.Document(projectId, id);
        // What a change moves beyond its own area: a document's state shows on the plan, its packages and Home.
        foreach (var also in Beyond(area)) changes.Area(projectId, also);
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
    /// (read-your-own-writes); and every change is posted to the screens too, for every other session and for a change
    /// no screen asked for (the worker, another way in). Cleared twice costs nothing.
    /// </summary>
    private void Flush()
    {
        if (changes.SearchTenants.Count > 0) { search.Publish(changes.SearchTenants); changes.SearchTenants.Clear(); }
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
        notifier.Post([.. changes.Tags]);
        changes.Clear();
    }
}

/// <summary>Where the screens' clearing route is (<c>Screens:Url</c>, the web container), and the secret it asks.</summary>
public sealed class ScreensOptions
{
    public const string Section = "Screens";
    /// <summary>The screens' own address on the internal network (http://web:3000); empty: nothing is posted.</summary>
    public string? Url { get; set; }
    public string? Secret { get; set; }
}

/// <summary>
/// Posts the labels changed outside a screen's act to the screens' clearing route (`/api/screens/changed`), a moment
/// later and gathered, so a burst of saves is one call. Best effort: a kept answer is also read again within the hour.
/// </summary>
public sealed class ScreensNotifier(IHttpClientFactory clients, IOptions<ScreensOptions> options, ILogger<ScreensNotifier> logger) : BackgroundService
{
    private readonly Channel<string[]> queue = Channel.CreateUnbounded<string[]>();

    public void Post(string[] tags)
    {
        if (!string.IsNullOrWhiteSpace(options.Value.Url) && tags.Length > 0) queue.Writer.TryWrite(tags);
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
                logger.LogWarning(e, "Telling the screens what changed failed; their kept answers are read again within the hour");
            }
        }
    }
}
