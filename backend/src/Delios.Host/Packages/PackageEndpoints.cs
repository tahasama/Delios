using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Delios.Host.Identity;

namespace Delios.Host.Packages;

public sealed record PackageSummary(Guid Id, string Number, string Title, string Reason, string State, int Members,
    bool HasRule, DateOnly? CompletionDate, DateTimeOffset CreatedAt);

public sealed record MemberView(Guid DocumentId, string DocumentNumber, string Title, string? Revision, string? Status,
    IReadOnlyList<string> Required, bool Ready, bool ByRule);

public sealed record PackageView(Guid Id, string Number, string Title, string? Description, string Reason,
    IReadOnlyList<string> RequiredStatuses, DateOnly? CompletionDate, PackageRule? Rule, IReadOnlyList<Guid> Excluded,
    IReadOnlyList<Guid> RecipientPartyIds, IReadOnlyList<Guid> OwnerIds, IReadOnlyList<Guid> AcceptorIds, string State,
    DateTimeOffset? AssessedAt, IReadOnlyList<ShortfallLine> Shortfall, DateTimeOffset? ShortfallIssuedAt,
    DateTimeOffset? ShortfallAcceptedAt, string? ShortfallAcceptedBy, DateTimeOffset? ClosedAt, string? ClosedBy,
    string? ClosureNote, DateTimeOffset? AcceptedAt, string? AcceptedBy, string CreatedBy, IReadOnlyList<MemberView> Members,
    IReadOnlyList<string> Transmittals);

public static class PackageEndpoints
{
    public static void MapPackageEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}/packages").WithTags("Packages")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>();

        project.MapGet("", ListAsync);
        project.MapPost("", CreateAsync).AddEndpointFilter<IdempotencyFilter>();
        project.MapGet("/{packageId:guid}", GetAsync);
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
    }

    private static async Task<IResult> ListAsync(HttpContext http, PackageService packages, CancellationToken cancellationToken) =>
        Results.Ok(await packages.ListAsync(ProjectAccessFilter.Of(http), cancellationToken));

    private static async Task<IResult> CreateAsync(
        CreatePackageRequest request, HttpContext http, PackageService packages, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        var (package, problem) = await packages.CreateAsync(access, request, cancellationToken);
        return problem ?? Results.Created($"/api/projects/{access.Project.Id}/packages/{package!.Id}",
            await ViewAsync(packages, package, cancellationToken));
    }

    private static async Task<IResult> GetAsync(Guid packageId, HttpContext http, PackageService packages, CancellationToken cancellationToken) =>
        await packages.ReadAsync(ProjectAccessFilter.Of(http), packageId, cancellationToken) is { } package
            ? Results.Ok(await ViewAsync(packages, package, cancellationToken))
            : Problems.NotFound("PACKAGE_NOT_FOUND", "No such package.");

    private static async Task<IResult> DeliverAsync(
        Guid packageId, DeliverRequest request, HttpContext http, PackageService packages, CancellationToken cancellationToken)
    {
        var (package, _, problem) = await packages.DeliverAsync(ProjectAccessFilter.Of(http), packageId, request, cancellationToken);
        return problem ?? Results.Ok(await ViewAsync(packages, package!, cancellationToken));
    }

    private static async Task<IResult> Act(HttpContext http, PackageService packages, Func<ProjectAccess, Task<(Package?, IResult?)>> act)
    {
        var (package, problem) = await act(ProjectAccessFilter.Of(http));
        return problem ?? Results.Ok(await ViewAsync(packages, package!, http.RequestAborted));
    }

    private static async Task<PackageView> ViewAsync(PackageService packages, Package p, CancellationToken cancellationToken)
    {
        var readiness = await packages.ReadinessAsync(p, cancellationToken);
        return new PackageView(p.Id, p.Number, p.Title, p.Description, p.Reason, p.RequiredStatuses, p.CompletionDate?.ToDateOnly(),
            p.Rule, p.Excluded, p.RecipientPartyIds, p.OwnerIds, p.AcceptorIds, p.State, p.AssessedAt?.ToDateTimeOffset(), p.Shortfall,
            p.ShortfallIssuedAt?.ToDateTimeOffset(), p.ShortfallAcceptedAt?.ToDateTimeOffset(), p.ShortfallAcceptedByName,
            p.ClosedAt?.ToDateTimeOffset(), p.ClosedByName, p.ClosureNote, p.AcceptedAt?.ToDateTimeOffset(), p.AcceptedByName,
            p.CreatedByName,
            readiness.Select(r => new MemberView(r.Member.DocumentId, r.DocumentNumber, r.Title, r.Revision, r.Status, r.Required,
                r.Ready, r.Member.ByRule)).ToList(),
            await packages.TransmittalNumbersAsync(p.Id, cancellationToken));
    }
}
