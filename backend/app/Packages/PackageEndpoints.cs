using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Delios.Host.Identity;

namespace Delios.Host.Packages;

/// <summary>One row of the package list.</summary>
public sealed record PackageSummary(Guid Id, string Number, string Title, string Reason, string State, int Members,
    bool HasRule, DateOnly? CompletionDate, DateTimeOffset CreatedAt, string Kind, string? Supplier, string? PurchaseOrder);

/// <summary>
/// One document in a package as returned to the browser: its released revision and status, the statuses it needs,
/// whether it is ready, and whether the rule brought it in.
/// </summary>
public sealed record MemberView(Guid DocumentId, string DocumentNumber, string Title, string? Revision, string? Status,
    IReadOnlyList<string> Required, bool Ready, bool ByRule, DateTimeOffset? RequestedAt, string? LatestRevision,
    string? LatestState, DateOnly? DueDate);

/// <summary>
/// Full detail of one package as returned to the browser, including each member's readiness and the numbers of the
/// transmittals that delivered it.
/// </summary>
public sealed record PackageView(Guid Id, string Number, string Title, string? Description, string Reason,
    IReadOnlyList<string> RequiredStatuses, DateOnly? CompletionDate, PackageRule? Rule, IReadOnlyList<Guid> Excluded,
    IReadOnlyList<Guid> RecipientPartyIds, IReadOnlyList<Guid> OwnerIds, IReadOnlyList<Guid> AcceptorIds, string State,
    DateTimeOffset? AssessedAt, IReadOnlyList<ShortfallLine> Shortfall, DateTimeOffset? ShortfallIssuedAt,
    DateTimeOffset? ShortfallAcceptedAt, string? ShortfallAcceptedBy, DateTimeOffset? ClosedAt, string? ClosedBy,
    string? ClosureNote, DateTimeOffset? AcceptedAt, string? AcceptedBy, string CreatedBy, IReadOnlyList<MemberView> Members,
    IReadOnlyList<PackageTransmittal> Transmittals, string Kind, Guid? SupplierPartyId, string? Supplier, string? PurchaseOrder,
    IReadOnlyList<string>? Reasons = null, System.Text.Json.JsonElement? Extras = null, string? AcceptNote = null,
    DateTimeOffset? SharedAt = null, string? SharedBy = null, bool AutoCreated = false, IReadOnlyList<string>? SupplierPeople = null,
    PackageNames? Names = null);

/// <summary>
/// A package's people and dates in words: who it goes to (its supplier, or its recipients), who puts it together
/// (else whoever opened it) and who accepts it, the supplier's code, when it was opened, and when it was delivered.
/// </summary>
public sealed record PackageNames(string To, string Owners, string Acceptors, string? SupplierCode, DateTimeOffset CreatedAt,
    DateTimeOffset? DeliveredAt);

/// <summary>A transmittal raised for a package: a delivery, a request to its supplier, or what the supplier sent back.</summary>
public sealed record PackageTransmittal(Guid Id, string Number, string Direction, DateTimeOffset IssuedAt, int Items);

/// <summary>
/// HTTP endpoints for packages: list, create, read, add and remove documents, set the rule, assess, shortfall, deliver
/// and accept. Mapped at startup; all logic lives in <c>PackageService</c>.
/// </summary>
public static class PackageEndpoints
{
    /// <summary>
    /// Registers the package routes under <c>/api/projects/{projectId}/packages</c>. Every route runs in a database
    /// transaction and checks the caller's access to the project first (endpoint filters).
    /// </summary>
    public static void MapPackageEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}/packages").WithTags("Packages")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>();

        project.MapGet("", ListAsync);
        project.MapPost("", CreateAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapGet("/{packageId:guid}", GetAsync);
        project.MapGet("/views", ViewsAsync);
        project.MapGet("/by-number/{number}", ByNumberAsync);
        project.MapPost("/{packageId:guid}/members", (Guid packageId, MembersRequest r, HttpContext h, PackageService s, CancellationToken c) =>
            Act(h, s, (a) => s.AddAsync(a, packageId, r, c)));
        project.MapPost("/{packageId:guid}/members/remove", (Guid packageId, MembersRequest r, HttpContext h, PackageService s, CancellationToken c) =>
            Act(h, s, (a) => s.RemoveAsync(a, packageId, r, c)));
        project.MapPut("/{packageId:guid}/rule", (Guid packageId, RuleRequest? r, HttpContext h, PackageService s, CancellationToken c) =>
            Act(h, s, (a) => s.SetRuleAsync(a, packageId, r, c)));
        project.MapPost("/{packageId:guid}/assess", (Guid packageId, HttpContext h, PackageService s, CancellationToken c) =>
            Act(h, s, (a) => s.AssessAsync(a, packageId, c)));
        project.MapPost("/{packageId:guid}/shortfall/issue", (Guid packageId, HttpContext h, PackageService s, CancellationToken c) =>
            Act(h, s, (a) => s.IssueShortfallAsync(a, packageId, c)));
        project.MapPost("/{packageId:guid}/shortfall/accept", (Guid packageId, NoteRequest r, HttpContext h, PackageService s, CancellationToken c) =>
            Act(h, s, (a) => s.AcceptShortfallAsync(a, packageId, r, c)));
        project.MapPost("/{packageId:guid}/deliver", DeliverAsync);
        project.MapPost("/{packageId:guid}/accept", (Guid packageId, NoteRequest r, HttpContext h, PackageService s, CancellationToken c) =>
            Act(h, s, (a) => s.AcceptAsync(a, packageId, r, c)));
        project.MapPost("/{packageId:guid}/share", (Guid packageId, HttpContext h, PackageService s, CancellationToken c) =>
            Act(h, s, (a) => s.ShareAsync(a, packageId, c)));
        project.MapPost("/{packageId:guid}/request", (Guid packageId, SupplyRequest r, HttpContext h, PackageService s, CancellationToken c) =>
            Act(h, s, (a) => s.RequestAsync(a, packageId, r, c)));
        project.MapPut("/{packageId:guid}", (Guid packageId, RenameRequest r, HttpContext h, PackageService s, CancellationToken c) =>
            Act(h, s, (a) => s.RenameAsync(a, packageId, r, c)));
        project.MapDelete("/{packageId:guid}", async (Guid packageId, HttpContext h, PackageService s, CancellationToken c, string? reason) =>
            await s.DeleteAsync(ProjectAccessFilter.Of(h), packageId, c, reason) ?? Results.NoContent());
    }

    /// <summary>GET the packages of the project, newest first.</summary>
    private static async Task<IResult> ListAsync(HttpContext http, PackageService packages, CancellationToken cancellationToken) =>
        Results.Ok(await packages.ListAsync(ProjectAccessFilter.Of(http), cancellationToken));

    /// <summary>POST a new package. Retried POSTs with the same idempotency key are answered once.</summary>
    private static async Task<IResult> CreateAsync(
        CreatePackageRequest request, HttpContext http, PackageService packages, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (package, problem) = await packages.CreateAsync(access, request, cancellationToken);
        return problem ?? Results.Created($"/api/projects/{access.Project.Id}/packages/{package!.Id}",
            await ViewAsync(packages, package, cancellationToken));
    }

    /// <summary>GET one package, brought up to date with its rule.</summary>
    private static async Task<IResult> GetAsync(Guid packageId, HttpContext http, PackageService packages, CancellationToken cancellationToken) =>
        await packages.ReadAsync(ProjectAccessFilter.Of(http), packageId, cancellationToken) is { } package
            ? Results.Ok(await ViewAsync(packages, package, cancellationToken, outside: !ProjectAccessFilter.Of(http).IsInternal))
            : Problems.NotFound("PACKAGE_NOT_FOUND", "No such package.");

    /// <summary>
    /// GET every package of one kind (DELIVERY or SUPPLY) in full, each brought up to date with its rule: soonest due
    /// first, those with no date last.
    /// </summary>
    private static async Task<IResult> ViewsAsync(string? kind, HttpContext http, PackageService packages, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var views = new List<PackageView>();
        foreach (var row in (await packages.ListAsync(access, cancellationToken)).Where(r => kind is null || r.Kind == kind))
            if (await packages.ReadAsync(access, row.Id, cancellationToken) is { } package)
                views.Add(await ViewAsync(packages, package, cancellationToken, outside: !access.IsInternal));
        return Results.Ok(views.OrderBy(v => v.CompletionDate is null).ThenBy(v => v.CompletionDate).ToList());
    }

    /// <summary>GET one package by its number, brought up to date with its rule.</summary>
    private static async Task<IResult> ByNumberAsync(string number, HttpContext http, PackageService packages, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var row = (await packages.ListAsync(access, cancellationToken)).FirstOrDefault(r => r.Number == number);
        return row is not null && await packages.ReadAsync(access, row.Id, cancellationToken) is { } package
            ? Results.Ok(await ViewAsync(packages, package, cancellationToken, outside: !access.IsInternal))
            : Problems.NotFound("PACKAGE_NOT_FOUND", "No such package.");
    }

    /// <summary>POST deliver: sends the ready documents on transmittals and fixes the package's contents.</summary>
    private static async Task<IResult> DeliverAsync(
        Guid packageId, DeliverRequest request, HttpContext http, PackageService packages, CancellationToken cancellationToken)
    {
        var (package, _, problem) = await packages.DeliverAsync(ProjectAccessFilter.Of(http), packageId, request, cancellationToken);
        return problem ?? Results.Ok(await ViewAsync(packages, package!, cancellationToken));
    }

    /// <summary>
    /// Shared body for the simple action endpoints: runs the service call with the caller's project access and returns
    /// the updated package, or the problem it reported.
    /// </summary>
    private static async Task<IResult> Act(HttpContext http, PackageService packages, Func<ProjectAccess, Task<(Package?, IResult?)>> act)
    {
        var (package, problem) = await act(ProjectAccessFilter.Of(http));
        return problem ?? Results.Ok(await ViewAsync(packages, package!, http.RequestAborted));
    }

    /// <summary>
    /// Builds the full package view, working out each member's readiness and looking up the transmittal numbers.
    /// </summary>
    private static async Task<PackageView> ViewAsync(PackageService packages, Package p, CancellationToken cancellationToken, bool outside = false)
    {
        var readiness = await packages.ReadinessAsync(p, cancellationToken);
        var transmittals = await packages.TransmittalsAsync(p, cancellationToken);
        // Its supplier sees what was asked of it on a transmittal, and nothing else.
        if (outside) readiness = readiness.Where(r => r.Member.RequestedAt is not null).ToList();
        return new PackageView(p.Id, p.Number, p.Title, p.Description, p.Reason, p.RequiredStatuses, p.CompletionDate?.ToDateOnly(),
            p.Rule, p.Excluded, p.RecipientPartyIds, p.OwnerIds, p.AcceptorIds, p.State, p.AssessedAt?.ToDateTimeOffset(), p.Shortfall,
            p.ShortfallIssuedAt?.ToDateTimeOffset(), p.ShortfallAcceptedAt?.ToDateTimeOffset(), p.ShortfallAcceptedByName,
            p.ClosedAt?.ToDateTimeOffset(), p.ClosedByName, p.ClosureNote, p.AcceptedAt?.ToDateTimeOffset(), p.AcceptedByName,
            p.CreatedByName,
            readiness.Select(r => new MemberView(r.Member.DocumentId, r.DocumentNumber, r.Title, r.Revision, r.Status, r.Required,
                r.Ready, r.Member.ByRule, r.Member.RequestedAt?.ToDateTimeOffset(), r.LatestRevision, r.LatestState,
                r.DueDate?.ToDateOnly())).ToList(),
            transmittals, p.Kind, p.SupplierPartyId,
            await packages.SupplierNameAsync(p, cancellationToken), p.PurchaseOrder, [p.Reason, .. p.OtherReasons],
            p.Extras is null ? null : System.Text.Json.JsonDocument.Parse(p.Extras).RootElement.Clone(), p.AcceptNote,
            p.SharedAt?.ToDateTimeOffset(), p.SharedByName, p.AutoCreated,
            outside ? null : (await packages.SupplierPeopleAsync(p, cancellationToken)).Select(x => x.Name).ToList(),
            await packages.NamesAsync(p, transmittals, cancellationToken));
    }
}
