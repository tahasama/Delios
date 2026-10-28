using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Delios.Host.Identity;

namespace Delios.Host.Packages;

/// <summary>One row of the package list.</summary>
public sealed record PackageSummary(Guid Id, string Number, string Title, string Reason, string State, int Members,
    bool HasRule, DateOnly? CompletionDate, DateTimeOffset CreatedAt, string Kind, string? Supplier, string? PurchaseOrder,
    Guid? ParentId = null);

/// <summary>A comment written in a review of a line's newest revision, as its package page shows it.</summary>
public sealed record LineComment(string By, string Text, bool Blocking, bool Settled, string Review, string Rev);

/// <summary>
/// One document of a package with what its package page shows beside it, read for every document at once (owner: the
/// heaviest computing found was each package page reading its documents one by one): its newest revision and where it
/// stands, when it was first sent in and first issued, how many revisions were sent in, the last review's outcome and
/// note, the transmittal it last came in on, and the comments its reviews hold.
/// </summary>
public sealed record PackageLineView(Guid DocumentId, string Number, string Title, bool IsPlaceholder,
    Guid? RevisionId, string? Revision, string? RevisionState, DateTimeOffset? SubmittedAt, string? StatusCode,
    string? ReturnedReason, DateTimeOffset? ReturnedAt, DateTimeOffset? ResentAt, DateTimeOffset? ReleasedAt, DateTimeOffset? IssuedAt,
    int Submissions, string? Outcome, string? OutcomeNote, Guid? IncomingId, string? IncomingNumber, IReadOnlyList<LineComment> Comments);

/// <summary>A package named in a path: its number and title, to open it.</summary>
public sealed record PackageLink(Guid Id, string Number, string Title);

/// <summary>
/// A package and everything under it: packages below (and how many are still open), its documents once each, how many are
/// released at the status their package needs, and how many are released at all.
/// </summary>
public sealed record PackageTally(int Packages, int Open, int Documents, int Ready, int Released);

/// <summary>A package sitting inside another: its number, title and state, how many packages sit directly in it, and its whole tally.</summary>
public sealed record BranchView(Guid Id, string Number, string Title, string State, int Branches, PackageTally Tally);

/// <summary>Where a package sits (the packages above it, top first), its branches, and the whole: it and everything under it.</summary>
public sealed record PackagePlace(Guid? ParentId, IReadOnlyList<PackageLink> Path, IReadOnlyList<BranchView> Branches, PackageTally Whole);

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
    PackageNames? Names = null, AsReceivedView? AsReceived = null, PackagePlace? Place = null, bool DeliveredToUs = false);

/// <summary>A supplier's package on a project taking documents as they come (<see cref="Intake"/>): what they are filed under.</summary>
public sealed record AsReceivedView(string DeliverableType, string DocType, string Discipline);

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
        project.MapGet("/{packageId:guid}/lines", async (Guid packageId, HttpContext h, PackageService s, CancellationToken c) =>
            await s.LinesAsync(ProjectAccessFilter.Of(h), packageId, c) is { } lines ? Results.Ok(lines) : Problems.NotFound("PACKAGE_NOT_FOUND", "No such package."));
        // What delivering it carries, for the New transmittal form; nothing is written.
        project.MapGet("/{packageId:guid}/going", async (Guid packageId, HttpContext h, PackageService s, CancellationToken c, bool? @short) =>
            await s.GoingAsync(ProjectAccessFilter.Of(h), packageId, c, @short == true) is var (going, problem) && problem is null ? Results.Ok(going) : problem!);
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
        project.MapPost("/{packageId:guid}/fill", (Guid packageId, HttpContext h, PackageService s, CancellationToken c) =>
            Act(h, s, (a) => s.FillAsync(a, packageId, c)));
        project.MapPost("/{packageId:guid}/request", (Guid packageId, SupplyRequest r, HttpContext h, PackageService s, CancellationToken c) =>
            Act(h, s, (a) => s.RequestAsync(a, packageId, r, c)));
        project.MapPut("/{packageId:guid}/place", (Guid packageId, MoveRequest r, HttpContext h, PackageService s, CancellationToken c) =>
            Act(h, s, (a) => s.MoveAsync(a, packageId, r, c)));
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
            ? Results.Ok(await ViewAsync(packages, package, cancellationToken, outside: !ProjectAccessFilter.Of(http).IsInternal,
                access: ProjectAccessFilter.Of(http)))
            : Problems.NotFound("PACKAGE_NOT_FOUND", "No such package.");

    /// <summary>
    /// GET every package of one kind (DELIVERY or SUPPLY) in full, each brought up to date with its rule: soonest due
    /// first, those with no date last.
    /// </summary>
    private static async Task<IResult> ViewsAsync(string? kind, HttpContext http, PackageService packages, CancellationToken cancellationToken,
        bool top = false, int? take = null)
    {
        var access = ProjectAccessFilter.Of(http);
        // The list shows the packages at the top, a page at a time (owner: only what is seen first); the tree asks for all.
        var views = (await packages.ListedAsync(access, kind, cancellationToken, top, take))
            .Select(x => ViewOf(x.Package, x.Parts, outside: !access.IsInternal, access)).ToList();
        return Results.Ok(views.OrderBy(v => v.CompletionDate is null).ThenBy(v => v.CompletionDate).ToList());
    }

    /// <summary>GET one package by its number, brought up to date with its rule.</summary>
    private static async Task<IResult> ByNumberAsync(string number, HttpContext http, PackageService packages, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        // One look by its number, never the whole list.
        return await packages.IdOfAsync(access, number, cancellationToken) is { } id && await packages.ReadAsync(access, id, cancellationToken) is { } package
            ? Results.Ok(await ViewAsync(packages, package, cancellationToken, outside: !access.IsInternal, access: access))
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
    private static async Task<PackageView> ViewAsync(PackageService packages, Package p, CancellationToken cancellationToken, bool outside = false,
        ProjectAccess? access = null) =>
        ViewOf(p, await packages.PartsAsync(p, outside, access, cancellationToken), outside, access);

    /// <summary>The package view from its parts.</summary>
    private static PackageView ViewOf(Package p, PackageParts parts, bool outside, ProjectAccess? access = null)
    {
        var intake = parts.Intake;
        var asReceived = intake?.Mode == Intake.AsReceived;
        // Its supplier sees what was asked of it on a transmittal, and in a package taking documents as they come, what they sent.
        var whole = !outside || (access is not null && PackageService.ReadsWhole(access, p));
        var readiness = whole ? parts.Readiness : parts.Readiness.Where(r => r.Member.RequestedAt is not null || asReceived).ToList();
        return new PackageView(p.Id, p.Number, p.Title, p.Description, p.Reason, p.RequiredStatuses, p.CompletionDate?.ToDateOnly(),
            p.Rule, p.Excluded, p.RecipientPartyIds, p.OwnerIds, p.AcceptorIds, p.State, p.AssessedAt?.ToDateTimeOffset(), p.Shortfall,
            p.ShortfallIssuedAt?.ToDateTimeOffset(), p.ShortfallAcceptedAt?.ToDateTimeOffset(), p.ShortfallAcceptedByName,
            p.ClosedAt?.ToDateTimeOffset(), p.ClosedByName, p.ClosureNote, p.AcceptedAt?.ToDateTimeOffset(), p.AcceptedByName,
            p.CreatedByName,
            readiness.Select(r => new MemberView(r.Member.DocumentId, r.DocumentNumber, r.Title, r.Revision, r.Status, r.Required,
                r.Ready, r.Member.ByRule, r.Member.RequestedAt?.ToDateTimeOffset(), r.LatestRevision, r.LatestState,
                r.DueDate?.ToDateOnly())).ToList(),
            parts.Transmittals, p.Kind, p.SupplierPartyId, parts.SupplierName, p.PurchaseOrder, [p.Reason, .. p.OtherReasons],
            p.Extras is null ? null : System.Text.Json.JsonDocument.Parse(p.Extras).RootElement.Clone(), p.AcceptNote,
            p.SharedAt?.ToDateTimeOffset(), p.SharedByName, p.AutoCreated,
            outside ? null : parts.SupplierPeople, outside && whole && parts.Names is { } named ? named with { To = "" } : parts.Names,
            asReceived ? new AsReceivedView(intake!.DeliverableType ?? "", intake.DocType ?? "", intake.Discipline ?? "") : null,
            parts.Place, DeliveredToUs: outside && whole);
    }
}
