using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Settings;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Actions;

/// <summary>
/// The days around an action, on two levels (owner): how many days before an action's day a document is needed (unless
/// a need says otherwise), and from how many days before it a missing document puts it at risk (unless the requirements
/// list gives the document its own). The organization's are the default of every project, read live (as the stamp's);
/// a project keeps only what it changed, where the organization leaves it free (switches <c>LEAD_DAYS</c> and
/// <c>RISK_WINDOW</c>, an exception counting). Nothing set anywhere: the app's 7 days.
/// </summary>
public static class ScheduleDays
{
    public const string LeadKey = "SCHEDULE_LEAD_DAYS";
    public const string RiskKey = "SCHEDULE_RISK_DAYS";
    public const string LeadSwitch = "LEAD_DAYS";
    public const string RiskSwitch = "RISK_WINDOW";
    public const int App = 7;

    /// <summary>A project's days: in force, whether each is its own, and the organization's beside them.</summary>
    public sealed record Days(int Lead, int Risk, bool OwnLead, bool OwnRisk, int OrganizationLead, int OrganizationRisk);

    /// <summary>The organization's days: what it set, else the app's.</summary>
    public static async Task<(int Lead, int Risk)> OrganizationAsync(DeliosDbContext db, CancellationToken cancellationToken)
    {
        var rows = await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == null && (s.Key == LeadKey || s.Key == RiskKey))
            .ToDictionaryAsync(s => s.Key, s => s.Value, cancellationToken);
        return (Read(rows.GetValueOrDefault(LeadKey)) ?? App, Read(rows.GetValueOrDefault(RiskKey)) ?? App);
    }

    /// <summary>One project's days: its own where it changed them, else the organization's.</summary>
    public static async Task<Days> ForProjectAsync(DeliosDbContext db, Guid projectId, CancellationToken cancellationToken)
    {
        var (lead, risk) = await OrganizationAsync(db, cancellationToken);
        var own = await OwnAsync(db, [projectId], cancellationToken);
        var mine = own.GetValueOrDefault(projectId);
        return new(mine.Lead ?? lead, mine.Risk ?? risk, mine.Lead is not null, mine.Risk is not null, lead, risk);
    }

    /// <summary>The risk window in force on each project asked about.</summary>
    public static async Task<Dictionary<Guid, int>> RiskByProjectAsync(DeliosDbContext db, IReadOnlyCollection<Guid> projectIds, CancellationToken cancellationToken)
    {
        var (_, risk) = await OrganizationAsync(db, cancellationToken);
        var own = await OwnAsync(db, projectIds, cancellationToken);
        return projectIds.ToDictionary(id => id, id => own.GetValueOrDefault(id).Risk ?? risk);
    }

    /// <summary>
    /// What each project changed: its own settings; before them, a number other than the app's kept on its schedule
    /// (where the days were set until they had two levels).
    /// </summary>
    private static async Task<Dictionary<Guid, (int? Lead, int? Risk)>> OwnAsync(DeliosDbContext db, IReadOnlyCollection<Guid> projectIds, CancellationToken cancellationToken)
    {
        var rows = await db.Set<Setting>().AsNoTracking()
            .Where(s => s.ProjectId != null && projectIds.Contains(s.ProjectId.Value) && (s.Key == LeadKey || s.Key == RiskKey))
            .ToListAsync(cancellationToken);
        var sources = await db.ScheduleSources.AsNoTracking().Where(s => projectIds.Contains(s.ProjectId))
            .ToDictionaryAsync(s => s.ProjectId, cancellationToken);
        return projectIds.ToDictionary(id => id, id =>
        {
            var source = sources.GetValueOrDefault(id);
            int? lead = Read(rows.FirstOrDefault(r => r.ProjectId == id && r.Key == LeadKey)?.Value)
                ?? (source is { DefaultLeadDays: var l } && l != App ? l : null);
            int? risk = Read(rows.FirstOrDefault(r => r.ProjectId == id && r.Key == RiskKey)?.Value)
                ?? (source is { RiskWindowDays: var w } && w != App ? w : null);
            return (lead, risk);
        });
    }

    private static int? Read(string? value) => int.TryParse(value, out var days) && days is >= 0 and <= 365 ? days : null;

    /// <summary>Body of setting the days: a number each, or following the organization again (null, with <c>Follow</c>).</summary>
    public sealed record DaysRequest(int? DefaultLeadDays = null, int? RiskWindowDays = null, bool FollowOrganization = false);

    /// <summary>Registers <c>GET</c> and <c>PUT /api/admin/schedule-days</c>: the organization's days (administrators).</summary>
    public static void MapScheduleDaysEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/schedule-days").WithTags("Administration").AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Configurers("The organization's days around an action are set by an administrator."));
        group.MapGet("", async (DeliosDbContext db, CancellationToken c) =>
        {
            var (lead, risk) = await OrganizationAsync(db, c);
            return Results.Ok(new { lead, risk });
        });
        group.MapPut("", OrganizationPutAsync);
    }

    /// <summary>
    /// The organization's days, the default of every project. Every project following them has its actions read again;
    /// one that changed its own keeps them.
    /// </summary>
    private static async Task<IResult> OrganizationPutAsync(DaysRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        if (request.DefaultLeadDays is < 0 or > 365 || request.RiskWindowDays is < 0 or > 365)
            return Problems.Invalid("DAYS_INVALID", "Days are between 0 and 365.");
        var me = await db.Users.AsNoTracking().SingleAsync(u => u.Id == http.User.UserId(), cancellationToken);
        var was = await OrganizationAsync(db, cancellationToken);
        await WriteAsync(db, http.User.TenantId(), null, LeadKey, request.DefaultLeadDays, me.Name, clock, cancellationToken);
        await WriteAsync(db, http.User.TenantId(), null, RiskKey, request.RiskWindowDays, me.Name, clock, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        var now = await OrganizationAsync(db, cancellationToken);
        foreach (var projectId in await db.Projects.AsNoTracking().Select(p => p.Id).ToListAsync(cancellationToken))
            await Readiness.RestateProjectAsync(db, clock, projectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(new Actor(me.Id, me.Name), "SCHEDULE_DAYS_SET", "Setting", null, "The organization's days around an action",
            $"Needed {now.Lead} days before an action, at risk from {now.Risk} days before (was {was.Lead} / {was.Risk}).", cancellationToken: cancellationToken);
        return Results.Ok(new { lead = now.Lead, risk = now.Risk });
    }

    /// <summary>
    /// A project's days (its Control room): each changed where the organization leaves it free (ROOM_FIXED otherwise,
    /// an exception counting); a number equal to the organization's is not kept, so the project goes on following it.
    /// "Follow the organization" forgets both. Every action of the project is read again.
    /// </summary>
    public static async Task<IResult> ProjectPutAsync(DaysRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.Holds(Verbs.Control) && !await Keepers.ConfiguresAsync(http))
            return Problems.Forbidden("CONTROL_ONLY", "The control function sets the days around an action.");
        if (request.DefaultLeadDays is < 0 or > 365 || request.RiskWindowDays is < 0 or > 365)
            return Problems.Invalid("DAYS_INVALID", "Days are between 0 and 365.");
        var projectId = access.Project.Id;
        var before = await ForProjectAsync(db, projectId, cancellationToken);
        int? lead = request.FollowOrganization ? null : request.DefaultLeadDays is { } l ? (l == before.OrganizationLead ? null : l) : before.OwnLead ? before.Lead : null;
        int? risk = request.FollowOrganization ? null : request.RiskWindowDays is { } r ? (r == before.OrganizationRisk ? null : r) : before.OwnRisk ? before.Risk : null;
        // Where fixed, only a project's own number is refused: following the organization again is always allowed.
        if (lead is not null && lead != (before.OwnLead ? before.Lead : null) && !await Liberty.IsFreeAsync(db, LeadSwitch, projectId, cancellationToken))
            return Problems.Forbidden("ROOM_FIXED", "The days a document is needed before an action: the organization keeps them the same on every project. An administrator changes them in the organization's Settings.");
        if (risk is not null && risk != (before.OwnRisk ? before.Risk : null) && !await Liberty.IsFreeAsync(db, RiskSwitch, projectId, cancellationToken))
            return Problems.Forbidden("ROOM_FIXED", "The risk window: the organization keeps it the same on every project. An administrator changes it in the organization's Settings.");
        await WriteAsync(db, access.Project.TenantId, projectId, LeadKey, lead, access.UserName, clock, cancellationToken);
        await WriteAsync(db, access.Project.TenantId, projectId, RiskKey, risk, access.UserName, clock, cancellationToken);
        // The numbers kept on the schedule before the days had two levels go back to the app's, so they never speak again.
        if (await db.ScheduleSources.SingleOrDefaultAsync(s => s.ProjectId == projectId, cancellationToken) is { } source)
        {
            source.DefaultLeadDays = App;
            source.RiskWindowDays = App;
        }
        await db.SaveChangesAsync(cancellationToken);
        await Readiness.RestateProjectAsync(db, clock, projectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        var after = await ForProjectAsync(db, projectId, cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "SCHEDULE_DAYS_SET", "Project", projectId, access.Project.Code,
            $"Needed {after.Lead} days before an action{(after.OwnLead ? "" : ", the organization's")}, at risk from {after.Risk} days before{(after.OwnRisk ? "" : ", the organization's")} (was {before.Lead} / {before.Risk}).",
            projectId, cancellationToken);
        return Results.Ok(after);
    }

    private static async Task WriteAsync(DeliosDbContext db, Guid tenantId, Guid? projectId, string key, int? days, string by, IClock clock,
        CancellationToken cancellationToken)
    {
        var row = await db.Set<Setting>().SingleOrDefaultAsync(s => s.ProjectId == projectId && s.Key == key, cancellationToken);
        if (days is null)
        {
            if (row is not null && projectId is not null) db.Remove(row);
            return;
        }
        if (row is null)
            db.Add(new Setting { TenantId = tenantId, ProjectId = projectId, Key = key, Value = days.Value.ToString(), UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = by });
        else
        {
            row.Value = days.Value.ToString();
            row.UpdatedAt = clock.GetCurrentInstant();
            row.UpdatedByName = by;
        }
    }
}
