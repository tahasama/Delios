using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Settings;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Packages;

/// <summary>Body of choosing how other organizations' documents come into the project.</summary>
public sealed record IntakeRequest(string? Mode, string? DeliverableType = null, string? DocType = null, string? Discipline = null,
    bool Understood = false);

/// <summary>How the project takes other organizations' documents, as the screens read it.</summary>
public sealed record IntakeView(string Mode, string? DeliverableType, string? DocType, string? Discipline);

/// <summary>
/// How other organizations' documents come into a project (owner: a configuration matter, one way or the other, never
/// both): by <b>placeholders</b> (the default: we register and number what we ask of them, they fill it; what comes
/// unplanned is matched to one of ours or made a document) or <b>as they come</b> (no placeholders: what they send is
/// taken under their own number, revision, status and review outcome once the check accepts it, filed under the three
/// values named here). Chosen in the Control room by an administrator or the control function, with its warning read;
/// once one way is in use (a placeholder asked of a supplier, or a document taken as it came) the other is refused.
/// </summary>
public static class Intake
{
    public const string Key = "SUPPLIER_INTAKE";
    public const string FilingKey = "AS_RECEIVED_FILING";
    public const string Placeholders = "PLACEHOLDERS";
    public const string AsReceived = "AS_RECEIVED";

    /// <summary>The project's way, with what documents taken as they come are filed under.</summary>
    public static async Task<IntakeView> ReadAsync(DeliosDbContext db, Guid projectId, CancellationToken cancellationToken)
    {
        var rows = await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == projectId && (s.Key == Key || s.Key == FilingKey))
            .ToDictionaryAsync(s => s.Key, s => s.Value, cancellationToken);
        if (rows.GetValueOrDefault(Key) != AsReceived) return new IntakeView(Placeholders, null, null, null);
        var filing = (rows.GetValueOrDefault(FilingKey) ?? "").Split('|');
        return new IntakeView(AsReceived, filing.ElementAtOrDefault(0), filing.ElementAtOrDefault(1), filing.ElementAtOrDefault(2));
    }

    /// <summary>Registers <c>PUT /api/projects/{projectId}/intake</c>.</summary>
    public static void MapIntakeEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Packages")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("/intake", async (HttpContext h, DeliosDbContext db, CancellationToken c) =>
            Results.Ok(await ReadAsync(db, ProjectAccessFilter.Of(h).Project.Id, c)));
        project.MapPut("/intake", SetAsync);
    }

    private static async Task<IResult> SetAsync(IntakeRequest request, HttpContext http, DeliosDbContext db, AuditLog audit, IClock clock,
        CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!await Keepers.ConfiguresAsync(http) && !access.Holds(Verbs.Control))
            return Problems.Forbidden("CONTROL_ONLY", "An administrator or the control function sets how documents come in.");
        var mode = request.Mode?.Trim().ToUpperInvariant();
        if (mode is not (Placeholders or AsReceived)) return Problems.Invalid("MODE_UNKNOWN", "By placeholders, or as they come.", new { field = "mode" });
        if (await Liberty.RoomRefusalAsync(db, Key, mode, cancellationToken) is { } fixedHere) return fixedHere;
        var projectId = access.Project.Id;
        var now = await ReadAsync(db, projectId, cancellationToken);
        string? filing = null;
        if (mode == AsReceived)
        {
            var catalog = await Catalog.LoadAsync(db, cancellationToken);
            var missing = new List<string>();
            if (!catalog.IsActive(ValueSets.DeliverableTypes, request.DeliverableType?.Trim() ?? "")) missing.Add("deliverableType");
            if (!catalog.IsActive(ValueSets.DocumentTypes, request.DocType?.Trim() ?? "")) missing.Add("docType");
            if (!catalog.IsActive(ValueSets.Disciplines, request.Discipline?.Trim() ?? "")) missing.Add("discipline");
            if (missing.Count > 0)
                return Problems.Invalid("FIELDS_REQUIRED", "Say what they are filed under: a deliverable type, a document type and a discipline, from the lists.",
                    new { fields = missing });
            if (!request.Understood)
                return Problems.Invalid("WARNING_NOT_READ", "Read what it does to the register, and tick that you understand.", new { field = "understood" });
            filing = $"{request.DeliverableType!.Trim()}|{request.DocType!.Trim()}|{request.Discipline!.Trim()}";
        }
        // One way or the other: once one is in use, the other would leave the register in two minds.
        if (mode != now.Mode)
        {
            if (mode == AsReceived && await db.PackageMembers.AnyAsync(m => m.RequestedAt != null
                    && db.Packages.Any(p => p.Id == m.PackageId && p.ProjectId == projectId && p.Kind == PackageKinds.Supply), cancellationToken))
                return Problems.Conflict("MODE_IN_USE", "Placeholders were already asked of suppliers on this project: it keeps taking documents by placeholder.");
            if (mode == Placeholders && await db.Documents.AnyAsync(d => d.ProjectId == projectId && d.AsReceived, cancellationToken))
                return Problems.Conflict("MODE_IN_USE", "Documents were already taken as they came on this project: it keeps taking them so.");
        }
        await Write(db, clock, access, Key, mode == Placeholders ? null : mode);
        await Write(db, clock, access, FilingKey, filing);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "SETTING_CHANGED", "Setting", null, Key,
            mode == AsReceived
                ? $"Other organizations' documents are taken as they come, filed under {filing!.Replace("|", " / ")}: their numbers, revisions, states and review outcomes go into the register as they are."
                : "Other organizations' documents come by placeholder.",
            projectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(await ReadAsync(db, projectId, cancellationToken));
    }

    private static async Task Write(DeliosDbContext db, IClock clock, ProjectAccess access, string key, string? value)
    {
        var row = await db.Set<Setting>().SingleOrDefaultAsync(s => s.ProjectId == access.Project.Id && s.Key == key);
        if (value is null)
        {
            if (row is not null) db.Remove(row);
            return;
        }
        if (row is null)
            db.Add(new Setting { TenantId = access.Project.TenantId, ProjectId = access.Project.Id, Key = key, Value = value,
                UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = access.UserName });
        else
        {
            row.Value = value;
            row.UpdatedAt = clock.GetCurrentInstant();
            row.UpdatedByName = access.UserName;
        }
    }
}
