using Delios.Host.Audit;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Settings;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Documents;

/// <summary>
/// The readers a document's Preview uses to show a source file in the page (owner: "all readers in that card, that we
/// can switch on and off"). The organization switches each on or off for every project (Settings → Viewing files); a
/// reader not installed here (Office, heavy on the server) or not built (a certified DWG reader, paid) is asked of DELIOS
/// instead (<see cref="Organizations.ProductRequests"/>). Where its switch (<see cref="Switch"/>) leaves it free, a project
/// switches off, and back on, the readers the organization has on. The PDF is always shown: it is the revision's.
/// </summary>
public static class Viewers
{
    public const string Switch = "VIEWERS";
    public const string Prefix = "VIEWER:";
    private const string On = "ON", Off = "OFF";

    public const string Pictures = "PICTURES", Workbooks = "WORKBOOKS", Schedules = "SCHEDULES", Text = "TEXT", Dxf = "DXF",
        Dwg = "DWG", Models = "MODELS", Office = "OFFICE", DwgCertified = "DWG_CERTIFIED";

    /// <summary>What a reader costs: free, heavy on the server (installed by DELIOS), or paid.</summary>
    public const string Free = "FREE", Heavy = "HEAVY", Paid = "PAID";

    /// <summary>One reader: what it shows, what it costs, and what is asked of DELIOS when it is not installed here.</summary>
    public sealed record Reader(string Key, string Title, string Shows, string Cost, string? Asks, string Said);

    public static readonly IReadOnlyList<Reader> All =
    [
        new(Pictures, "Pictures", "JPG, PNG, GIF, WebP, AVIF, BMP", Free, null, "Shown as they are. SVG stays a download: it can carry code."),
        new(Workbooks, "Excel and CSV", ".xlsx, .xlsm, .xls, .csv", Free, null, "Each sheet as Excel shows it, its last calculated values; nothing in it runs."),
        new(Schedules, "Primavera P6 exports", ".xer", Free, null, "Each project's activities under their WBS, as P6 lays them out."),
        new(Text, "Plain text", ".txt, .log, .json, .xml, .md, .yaml…", Free, null, "Its first 2 MB, as text."),
        new(Dxf, "DXF drawings", ".dxf", Free, null, "Drawn in the page, its layers switched on and off."),
        new(Dwg, "DWG drawings, free reader", ".dwg", Free, null,
            "Read by LibreDWG, for viewing only: paper layouts, linked drawings and pictures are not shown, lettering is approximate, some drawings do not open."),
        new(Models, "3D models", "IFC, glTF, GLB, OBJ, STL", Free, null, "Turned, moved and zoomed, each part shown or hidden; read in the browser."),
        new(Office, "Word and PowerPoint", ".doc, .docx, .ppt, .pptx, .odt, .rtf, .vsdx…", Heavy, "OFFICE_READER",
            "Shown as the PDF LibreOffice makes of them. About 1.5 GB to install and up to 1 GB of memory on the server."),
        new(DwgCertified, "DWG drawings, certified reader", ".dwg", Paid, Organizations.ProductRequests.DwgReader,
            "Every drawing as AutoCAD shows it, its layouts too. Paid, by use or by the year."),
    ];

    /// <summary>Whether the reader is there to be switched on: free ones in the page always, converters once installed.</summary>
    public static bool Installed(Reader reader, PreviewOptions options) => reader.Key switch
    {
        Dwg => !string.IsNullOrWhiteSpace(options.DwgUrl),
        Office => !string.IsNullOrWhiteSpace(options.OfficeUrl),
        DwgCertified => false,
        _ => true,
    };

    private static async Task<Dictionary<string, string>> RowsAsync(DeliosDbContext db, Guid? projectId, CancellationToken cancellationToken) =>
        await db.Set<Setting>().AsNoTracking().Where(s => s.ProjectId == projectId && s.Key.StartsWith(Prefix))
            .ToDictionaryAsync(s => s.Key[Prefix.Length..], s => s.Value, cancellationToken);

    /// <summary>The organization's answer: on unless switched off, for a reader installed here.</summary>
    private static bool OrganizationOn(Reader reader, PreviewOptions options, Dictionary<string, string> rows) =>
        Installed(reader, options) && rows.GetValueOrDefault(reader.Key) != Off;

    /// <summary>The readers on for a project: the organization's on, less those the project switched off where it is free.</summary>
    public static async Task<HashSet<string>> OnForAsync(DeliosDbContext db, Guid projectId, PreviewOptions options, CancellationToken cancellationToken)
    {
        var org = await RowsAsync(db, null, cancellationToken);
        var free = await Liberty.IsFreeAsync(db, Switch, projectId, cancellationToken);
        var own = free ? await RowsAsync(db, projectId, cancellationToken) : [];
        return All.Where(r => OrganizationOn(r, options, org) && own.GetValueOrDefault(r.Key) != Off).Select(r => r.Key).ToHashSet();
    }

    /// <summary>A preview endpoint's refusal when its reader is off on the project (the file is still downloaded).</summary>
    public static async Task<IResult?> OffRefusalAsync(DeliosDbContext db, Guid projectId, string key, string fileName, PreviewOptions options,
        CancellationToken cancellationToken) =>
        (await OnForAsync(db, projectId, options, cancellationToken)).Contains(key) ? null
        : Problems.Invalid("VIEWER_OFF", $"{All.First(r => r.Key == key).Title} are not shown in the page on this project: download {fileName} to open it.");

    public sealed record SwitchRequest(bool On);

    public static void MapViewerEndpoints(this IEndpointRouteBuilder app)
    {
        var org = app.MapGroup("/api/admin/viewers").WithTags("Administration").AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter(Keepers.Configurers("The readers are switched by an administrator."));
        org.MapGet("", OrganizationAsync);
        org.MapPut("/{key}", SetOrganizationAsync);

        var project = app.MapGroup("/api/projects/{projectId:guid}/viewers").WithTags("Documents")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("", ProjectAsync);
        project.MapPut("/{key}", SetProjectAsync);
    }

    /// <summary>Every reader, installed or not, with the organization's answer and what was last asked of DELIOS for it.</summary>
    private static async Task<IResult> OrganizationAsync(HttpContext http, DeliosDbContext db, IOptions<PreviewOptions> options,
        CancellationToken cancellationToken)
    {
        var rows = await RowsAsync(db, null, cancellationToken);
        var tenantId = http.User.TenantId();
        var asked = await db.Set<Organizations.ProductRequest>().AsNoTracking().Where(r => r.TenantId == tenantId)
            .OrderByDescending(r => r.At).Select(r => new { r.What, r.ByName, r.At, r.Message }).ToListAsync(cancellationToken);
        return Results.Ok(All.Select(r => new
        {
            r.Key, r.Title, r.Shows, r.Cost, r.Said, r.Asks,
            Installed = Installed(r, options.Value),
            On = OrganizationOn(r, options.Value, rows),
            Asked = r.Asks is null ? null : asked.Where(a => a.What == r.Asks).Select(a => new { a.ByName, a.At, a.Message }).FirstOrDefault(),
        }));
    }

    private static async Task<IResult> SetOrganizationAsync(string key, SwitchRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        IClock clock, IOptions<PreviewOptions> options, CancellationToken cancellationToken)
    {
        var reader = All.FirstOrDefault(r => r.Key == key);
        if (reader is null) return Problems.NotFound("NO_SUCH_READER", "There is no such reader.");
        if (request.On && !Installed(reader, options.Value))
            return Problems.Invalid("NOT_INSTALLED", $"{reader.Title}: not installed here. Ask DELIOS for it.");
        await WriteAsync(db, http, null, reader.Key, request.On ? null : Off, clock, cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "VIEWER_SWITCHED", "Setting", null, reader.Title,
            $"On every project: {(request.On ? "on" : "off")}.", cancellationToken: cancellationToken);
        return Results.Ok(new { reader.Key, request.On });
    }

    /// <summary>The readers the organization has on (only those a project sees), with this project's answer.</summary>
    private static async Task<IResult> ProjectAsync(HttpContext http, DeliosDbContext db, IOptions<PreviewOptions> options, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var org = await RowsAsync(db, null, cancellationToken);
        var on = await OnForAsync(db, access.Project.Id, options.Value, cancellationToken);
        var free = await Liberty.IsFreeAsync(db, Switch, access.Project.Id, cancellationToken);
        return Results.Ok(new
        {
            Readers = All.Where(r => OrganizationOn(r, options.Value, org))
                .Select(r => new { r.Key, r.Title, r.Shows, r.Cost, r.Said, On = on.Contains(r.Key) }),
            MayChange = free && await KeeperAsync(http, access),
            Free = free,
            Exception = await Liberty.ExceptionHereAsync(db, Switch, access.Project.Id, cancellationToken),
        });
    }

    private static async Task<IResult> SetProjectAsync(string key, SwitchRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        IClock clock, IOptions<PreviewOptions> options, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!await KeeperAsync(http, access))
            return Problems.Forbidden("CONTROL_ONLY", "Whoever acts as the control function switches the readers on this project.");
        if (!await Liberty.IsFreeAsync(db, Switch, access.Project.Id, cancellationToken))
            return Problems.Forbidden("ROOM_FIXED", "The organization keeps the readers the same on every project.");
        var reader = All.FirstOrDefault(r => r.Key == key);
        if (reader is null || !OrganizationOn(reader, options.Value, await RowsAsync(db, null, cancellationToken)))
            return Problems.Invalid("NOT_AVAILABLE", "The organization has not switched that reader on.");
        await WriteAsync(db, http, access.Project.Id, reader.Key, request.On ? null : Off, clock, cancellationToken);
        await audit.WriteAsync(http.User.Actor(), "VIEWER_SWITCHED", "Setting", null, reader.Title,
            $"On {access.Project.Code}: {(request.On ? "on" : "off")}.", projectId: access.Project.Id, cancellationToken: cancellationToken);
        return Results.Ok(new { reader.Key, request.On });
    }

    private static async Task<bool> KeeperAsync(HttpContext http, ProjectAccess access) =>
        access.IsInternal && (access.Holds(Verbs.Control) || await Keepers.ConfiguresAsync(http));

    /// <summary>Only "off" is kept: a reader on is what nothing says.</summary>
    private static async Task WriteAsync(DeliosDbContext db, HttpContext http, Guid? projectId, string key, string? value, IClock clock,
        CancellationToken cancellationToken)
    {
        var full = Prefix + key;
        var row = await db.Set<Setting>().SingleOrDefaultAsync(s => s.ProjectId == projectId && s.Key == full, cancellationToken);
        if (value is null)
        {
            if (row is not null) db.Remove(row);
        }
        else
        {
            var by = (await db.Users.AsNoTracking().SingleAsync(u => u.Id == http.User.UserId(), cancellationToken)).Name;
            if (row is null)
                db.Add(new Setting { TenantId = http.User.TenantId(), ProjectId = projectId, Key = full, Value = value, UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = by });
            else
            {
                row.Value = value;
                row.UpdatedAt = clock.GetCurrentInstant();
                row.UpdatedByName = by;
            }
        }
        await db.SaveChangesAsync(cancellationToken);
    }
}
