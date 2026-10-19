using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Settings;

/// <summary>
/// One answer an organization (or one of its projects) gave about how it works: what a state is called, who carries
/// out an act, which way a policy goes. Kept as key and value so a new question needs no new table; the screens own
/// the meaning of each key. Every change is audited.
/// </summary>
public sealed class Setting
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    /// <summary>Empty for the organization's own answers; set for one project's.</summary>
    public Guid? ProjectId { get; set; }
    public required string Key { get; set; }
    public required string Value { get; set; }
    public Instant UpdatedAt { get; set; }
    public required string UpdatedByName { get; set; }
}

/// <summary>EF Core mapping for <see cref="Setting"/>: one value per key, per organization or per project.</summary>
internal sealed class SettingConfiguration : IEntityTypeConfiguration<Setting>
{
    /// <summary>Called by EF Core when it builds the database model at startup and for migrations.</summary>
    public void Configure(EntityTypeBuilder<Setting> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.ProjectId, x.Key }).IsUnique().AreNullsDistinct(false);
        b.Property(x => x.Key).HasMaxLength(128);
        b.Property(x => x.Value).HasMaxLength(4000);
        b.Property(x => x.UpdatedByName).HasMaxLength(200);
    }
}

/// <summary>Body of setting one answer. An empty value removes it, so the default applies again.</summary>
public sealed record SettingRequest(string? Value);

/// <summary>One answer as the screens read it.</summary>
public sealed record SettingView(string Key, string Value, DateTimeOffset UpdatedAt, string UpdatedBy);

/// <summary>
/// GET and PUT the organization's answers (<c>/api/settings</c>) and a project's (<c>/api/projects/{id}/settings</c>).
/// Anyone signed in reads them; an administrator changes the organization's, and an administrator or the control function
/// a project's.
/// </summary>
public static class SettingEndpoints
{
    public static void MapSettingEndpoints(this IEndpointRouteBuilder app)
    {
        var org = app.MapGroup("/api/settings").WithTags("Settings").RequireAuthorization().AddEndpointFilter<TransactionFilter>();
        org.MapGet("", (HttpContext h, DeliosDbContext db, CancellationToken c, string? prefix) => ListAsync(db, null, prefix, c));
        org.MapPut("/{key}", async (string key, SettingRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c) =>
        {
            var me = await db.Users.AsNoTracking().SingleAsync(u => u.Id == h.User.UserId(), c);
            if (!await Keepers.ConfiguresAsync(h)) return Problems.Forbidden("ADMIN_ONLY", "An administrator answers for the organization.");
            return await SetAsync(db, audit, clock, h.User.TenantId(), null, key, r.Value, me.Id, me.Name, c);
        });

        var project = app.MapGroup("/api/projects/{projectId:guid}/settings").WithTags("Settings")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("", (HttpContext h, DeliosDbContext db, CancellationToken c, string? prefix) =>
            ListAsync(db, ProjectAccessFilter.Of(h).Project.Id, prefix, c));
        project.MapPut("/{key}", async (string key, SettingRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c) =>
        {
            var access = ProjectAccessFilter.Of(h);
            if (!await Keepers.ConfiguresAsync(h) && !access.Holds(Verbs.Control))
                return Problems.Forbidden("CONTROL_ONLY", "An administrator or the control function answers for the project.");
            // What the organization keeps fixed is the same on every project (owner: two levels of settings).
            if (await Liberty.RoomRefusalAsync(db, key.Trim(), r.Value, c) is { } fixedHere) return fixedHere;
            var result = await SetAsync(db, audit, clock, access.Project.TenantId, access.Project.Id, key, r.Value, access.UserId, access.UserName, c);
            // What makes a document count for an action changed: every action of the project is read again at once.
            if (key.Trim() is "POLICY_READY" or "POLICY_RELEASE")
            {
                await Actions.Readiness.RestateProjectAsync(db, clock, access.Project.Id, c);
                await db.SaveChangesAsync(c);
            }
            return result;
        });
    }

    private static async Task<IResult> ListAsync(DeliosDbContext db, Guid? projectId, string? prefix, CancellationToken cancellationToken)
    {
        var query = db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == projectId);
        if (!string.IsNullOrEmpty(prefix)) query = query.Where(s => s.Key.StartsWith(prefix));
        var rows = await query.OrderBy(s => s.Key).ToListAsync(cancellationToken);
        return Results.Ok(rows.Select(s => new SettingView(s.Key, s.Value, s.UpdatedAt.ToDateTimeOffset(), s.UpdatedByName)));
    }

    private static async Task<IResult> SetAsync(DeliosDbContext db, AuditLog audit, IClock clock, Guid tenantId, Guid? projectId,
        string key, string? value, Guid userId, string userName, CancellationToken cancellationToken)
    {
        key = key.Trim();
        if (key.Length is 0 or > 128) return Problems.Invalid("KEY_INVALID", "A setting is named by 1 to 128 characters.");
        if (value is { Length: > 4000 }) return Problems.Invalid("VALUE_TOO_LONG", "A setting holds at most 4000 characters.");
        var row = await db.Set<Setting>().SingleOrDefaultAsync(s => s.ProjectId == projectId && s.Key == key, cancellationToken);
        var was = row?.Value;
        if (string.IsNullOrWhiteSpace(value))
        {
            if (row is not null) db.Remove(row);
        }
        else if (row is null)
        {
            db.Add(new Setting { TenantId = tenantId, ProjectId = projectId, Key = key, Value = value.Trim(), UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = userName });
        }
        else
        {
            row.Value = value.Trim();
            row.UpdatedAt = clock.GetCurrentInstant();
            row.UpdatedByName = userName;
        }
        await audit.WriteAsync(new Actor(userId, userName), "SETTING_CHANGED", "Setting", null, key,
            $"{was ?? "(default)"} → {(string.IsNullOrWhiteSpace(value) ? "(default)" : value.Trim())}", projectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }
}

/// <summary>
/// What is kept about people's activity (owner): the organization's choice, never a project's, since a privacy policy is
/// the organization's. Acts on documents (registered, reviewed, released, sent) are always kept: they are the
/// register's own record. Reading (a document opened, a file downloaded) is kept unless switched off
/// (<c>TRACK_READING</c> = OFF). Sign-ins are always kept for security, and shown on a person's activity only when
/// switched on (<c>TRACK_SIGN_INS</c> = ON).
/// </summary>
public static class Tracking
{
    public const string ReadingKey = "TRACK_READING";
    public const string SignInsKey = "TRACK_SIGN_INS";
    /// <summary>The acts that are reading, kept or not by <see cref="ReadingKey"/>.</summary>
    public static readonly string[] Reading = ["DOCUMENT_VIEWED", "DOWNLOAD"];
    /// <summary>The sign-ins, always kept, shown or not by <see cref="SignInsKey"/>.</summary>
    public static readonly string[] SignIns = ["SIGN_IN", "SIGN_IN_MFA", "SIGN_IN_SSO", "SIGN_IN_FAILED", "ACCOUNT_LOCKED", "LOGIN"];

    private static Task<string?> OrgAsync(DeliosDbContext db, string key, CancellationToken cancellationToken) =>
        db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == null && s.Key == key).Select(s => s.Value).FirstOrDefaultAsync(cancellationToken);

    /// <summary>Whether a document opened or a file downloaded is kept (on unless switched off).</summary>
    public static async Task<bool> KeepsReadingAsync(DeliosDbContext db, CancellationToken cancellationToken) =>
        await OrgAsync(db, ReadingKey, cancellationToken) != "OFF";

    /// <summary>Whether sign-ins show on a person's activity (off unless switched on).</summary>
    public static async Task<bool> ShowsSignInsAsync(DeliosDbContext db, CancellationToken cancellationToken) =>
        await OrgAsync(db, SignInsKey, cancellationToken) == "ON";
}

/// <summary>
/// The project's answers the backend acts on, read the way the screens read them: who carries out an act
/// (<c>__ALL__</c> = CONTROL | SELF | CUSTOM, then the act's own key), whether an act is left out
/// (<c>SKIP:{act}</c> = OFF), and a policy's chosen option.
/// </summary>
public static class ProjectAnswers
{
    /// <summary>Acts left to the people doing the work unless the project says otherwise (the screens' <c>workByDefault</c>).</summary>
    /// Sending a review to its reviewers and sending documents out were read by nothing before they worked: left to the
    /// people doing the work, existing projects go on as they did until they choose otherwise.
    public static readonly string[] WorkByDefault = ["AUTHORIZE_REVISION", "REVIEW_ISSUE", "ISSUE"];

    private static Task<Dictionary<string, string>> AllAsync(DeliosDbContext db, Guid projectId, CancellationToken cancellationToken) =>
        db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == projectId).ToDictionaryAsync(s => s.Key, s => s.Value, cancellationToken);

    /// <summary>
    /// Whether the control function carries out this act on the project. Unanswered, it follows the project: Document
    /// Control does it where somebody holds the control function.
    /// </summary>
    public static async Task<bool> ControlDoesAsync(DeliosDbContext db, Guid projectId, string act, CancellationToken cancellationToken)
    {
        var answers = await AllAsync(db, projectId, cancellationToken);
        var all = answers.GetValueOrDefault("__ALL__");
        if (all == "CONTROL") return true;
        if (all == "SELF") return false;
        if (all == "CUSTOM" && answers.GetValueOrDefault(act) is { } own && own is "CONTROL" or "SELF") return own == "CONTROL";
        // Left to the people doing the work unless the project says otherwise, as the screens read it.
        if (WorkByDefault.Contains(act)) return false;
        return await db.Memberships.AnyAsync(m => m.ProjectId == projectId && m.Active && m.Function!.Active
            && (m.ActsAsControl || m.Function.Rules.Any(r => r.Verbs.Contains(Verbs.Control)))
            && db.Users.Any(u => u.Id == m.UserId && u.Active), cancellationToken);
    }

    /// <summary>
    /// Whether a request for this act, carried out by the control function, needs the confirmation of whoever holds Manage first
    /// (<c>CONFIRM:{act}</c> = ON). Without the control function nothing is confirmed.
    /// </summary>
    public static async Task<bool> NeedsConfirmationAsync(DeliosDbContext db, Guid projectId, string act, CancellationToken cancellationToken) =>
        ((await AllAsync(db, projectId, cancellationToken)).GetValueOrDefault($"CONFIRM:{act}") ?? DefaultConfirm(act)) == "ON"
        // Joining a project is confirmed whoever adds (the control function, or everyone on the project).
        && (act == "PROJECT_PEOPLE" || await ControlDoesAsync(db, projectId, act, cancellationToken));

    /// <summary>
    /// Whether an act asks whoever holds Manage to confirm when the project said nothing: joining a project does (owner's
    /// decision: every addition is a request whoever holds Manage confirms); adding to actions does not.
    /// </summary>
    public static string DefaultConfirm(string act) => act == "PROJECT_PEOPLE" ? "ON" : "OFF";

    /// <summary>Whether the organization left this act out on the project.</summary>
    public static async Task<bool> IsOffAsync(DeliosDbContext db, Guid projectId, string act, CancellationToken cancellationToken) =>
        (await AllAsync(db, projectId, cancellationToken)).GetValueOrDefault($"SKIP:{act}") == "OFF";

    /// <summary>Every answer the project gave, by key.</summary>
    public static Task<Dictionary<string, string>> AnswersAsync(DeliosDbContext db, Guid projectId, CancellationToken cancellationToken) =>
        AllAsync(db, projectId, cancellationToken);

    /// <summary>The project's answer to a policy, else the organization's, else <paramref name="fallback"/> (the app's).</summary>
    public static async Task<string> PolicyOrDefaultAsync(DeliosDbContext db, Guid projectId, string key, string fallback, CancellationToken cancellationToken)
    {
        var rows = await db.Set<Setting>().AsNoTracking().Where(s => s.Key == key && (s.ProjectId == projectId || s.ProjectId == null))
            .Select(s => new { s.ProjectId, s.Value }).ToListAsync(cancellationToken);
        return rows.FirstOrDefault(r => r.ProjectId == projectId)?.Value ?? rows.FirstOrDefault(r => r.ProjectId == null)?.Value ?? fallback;
    }

    /// <summary>The project's chosen option for a policy, or null when it has not chosen.</summary>
    public static async Task<string?> PolicyAsync(DeliosDbContext db, Guid projectId, string key, CancellationToken cancellationToken) =>
        (await AllAsync(db, projectId, cancellationToken)).GetValueOrDefault(key);
}
