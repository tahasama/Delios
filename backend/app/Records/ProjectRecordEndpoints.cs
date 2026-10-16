using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Actions;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Records;

// ── Requests ──────────────────────────────────────────────────────────────────

public sealed record AssetRequest(string? Code, string? Name, string? Area = null, string? System = null, string? Unit = null,
    string? Description = null, Dictionary<string, string?>? Extras = null);
public sealed record LinkAssetRequest(string? AssetCode);
/// <summary>From an asset's page, through the register opened for it: the documents to link, and those to unlink.</summary>
public sealed record AssetDocumentsRequest(Guid[]? Add, Guid[]? Remove);
public sealed record ExceptionRequest(string? Item, string? Clauses, string? Reason, string? Authority, DateOnly? StartDate, DateOnly? ReviewPoint = null);
public sealed record NumberRangeRequest(string? Prefix, int From, int To, string? IssuedTo);
public sealed record CallsRequest(string[]? Departments, DateOnly? DueOn);
public sealed record AnswerCallRequest(string? Note);
public sealed record ReadinessRequest(string? Department, bool Available, string? Note);

/// <summary>Taking a confirmation back: the reason is kept with it.</summary>
public sealed record RevokeReadinessRequest(string? Department, string? Reason);
public sealed record SenderIssueRequest(string? Sender);
public sealed record ControlledUpload(string? Kind, string? Key, string? Title, JsonElement Payload, JsonElement? Diff = null, int RowCount = 0,
    string? SourceName = null, long? SourceSize = null, string? SourceHash = null, string? Notes = null, string? VersionLabel = null);
public sealed record ControlledDecision(bool Approve, string? Reason = null, string? AppliedSummary = null);

// ── Endpoints ─────────────────────────────────────────────────────────────────

/// <summary>
/// The project's own records kept beside the register: assets and the documents
/// that describe them, published exceptions, number ranges given to parties, the
/// calls to departments and their readiness, the lists issued to senders, and
/// uploaded lists waiting for a decision.
/// </summary>
public static partial class ProjectRecordEndpoints
{
    public static void MapProjectRecordEndpoints(this IEndpointRouteBuilder app)
    {
        var p = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Records")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();

        // Assets
        p.MapGet("/assets", AssetsAsync);
        p.MapGet("/assets/{assetId:guid}", AssetAsync);
        p.MapPost("/assets", AddAssetAsync);
        p.MapPut("/assets/{assetId:guid}", UpdateAssetAsync);
        p.MapPost("/assets/{assetId:guid}/retire", RetireAssetAsync);
        p.MapGet("/documents/{documentId:guid}/assets", DocumentAssetsAsync);
        p.MapPost("/documents/{documentId:guid}/assets", LinkAssetAsync);
        p.MapDelete("/document-assets/{linkId:guid}", UnlinkAssetAsync);
        p.MapPost("/assets/{assetId:guid}/documents", SetAssetDocumentsAsync);

        // Exceptions and number ranges
        p.MapGet("/exceptions", async (HttpContext h, DeliosDbContext db, CancellationToken c) =>
            Results.Ok(await db.Set<ExceptionEntry>().AsNoTracking().Where(x => x.ProjectId == ProjectAccessFilter.Of(h).Project.Id)
                .OrderByDescending(x => x.StartDate).ToListAsync(c)));
        p.MapPost("/exceptions", AddExceptionAsync);
        p.MapGet("/number-ranges", async (HttpContext h, DeliosDbContext db, CancellationToken c) =>
            Results.Ok(await db.Set<NumberRange>().AsNoTracking().Where(x => x.ProjectId == ProjectAccessFilter.Of(h).Project.Id)
                .OrderBy(x => x.Prefix).ThenBy(x => x.From).ToListAsync(c)));
        p.MapPost("/number-ranges", IssueRangeAsync);

        // Calls to departments, readiness, lists issued to senders
        p.MapGet("/requirement-calls", async (HttpContext h, DeliosDbContext db, CancellationToken c) =>
            Results.Ok(await db.Set<RequirementCall>().AsNoTracking().Where(x => x.ProjectId == ProjectAccessFilter.Of(h).Project.Id)
                .OrderBy(x => x.Department).ThenByDescending(x => x.IssuedAt).ToListAsync(c)));
        p.MapPost("/requirement-calls", IssueCallsAsync);
        p.MapPost("/requirement-calls/{callId:guid}/remind", RemindCallAsync);
        p.MapPost("/requirement-calls/{callId:guid}/answer", AnswerCallAsync);
        p.MapGet("/readiness", async (HttpContext h, DeliosDbContext db, CancellationToken c) =>
            Results.Ok(await db.Set<ReadinessConfirmation>().AsNoTracking().Where(x => x.ProjectId == ProjectAccessFilter.Of(h).Project.Id)
                .ToListAsync(c)));
        p.MapPost("/activities/{activityId:guid}/readiness", ConfirmReadinessAsync);
        p.MapPost("/activities/{activityId:guid}/readiness/revoke", RevokeReadinessAsync);
        p.MapPost("/activities/{activityId:guid}/notify-departments", NotifyDepartmentsAsync);
        p.MapPut("/activities/{activityId:guid}/departments", SetDepartmentsAsync);
        p.MapGet("/people/pending", PendingPeopleAsync);
        p.MapPost("/people/{membershipId:guid}/confirm", (Guid membershipId, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock,
            Notifications.Notifier notifier, Transmittals.TransmittalService transmittals, CancellationToken c) =>
            SettlePersonAsync(membershipId, null, h, db, audit, clock, notifier, transmittals, c));
        p.MapPost("/people/{membershipId:guid}/refuse", (Guid membershipId, RefusePersonRequest r, HttpContext h, DeliosDbContext db, AuditLog audit,
            IClock clock, Notifications.Notifier notifier, Transmittals.TransmittalService transmittals, CancellationToken c) =>
            SettlePersonAsync(membershipId, r.Note ?? "", h, db, audit, clock, notifier, transmittals, c));
        p.MapGet("/sender-issues", async (HttpContext h, DeliosDbContext db, CancellationToken c) =>
            Results.Ok(await db.Set<SenderIssue>().AsNoTracking().Where(x => x.ProjectId == ProjectAccessFilter.Of(h).Project.Id)
                .OrderByDescending(x => x.IssuedAt).ToListAsync(c)));
        p.MapPost("/sender-issues", IssueToSenderAsync);

        // Uploaded lists for a decision: the project's, and (outside a project) the organization's.
        p.MapGet("/controlled", (HttpContext h, DeliosDbContext db, CancellationToken c, string? kind, string? key) =>
            ControlledListAsync(db, ProjectAccessFilter.Of(h).Project.Id, kind, key, c));
        p.MapPost("/controlled", (ControlledUpload r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c) =>
            UploadAsync(h, db, audit, clock, ProjectAccessFilter.Of(h).Project.Id, r, c));
        var org = app.MapGroup("/api/controlled").WithTags("Records").RequireAuthorization().AddEndpointFilter<TransactionFilter>();
        org.MapGet("", (DeliosDbContext db, CancellationToken c, string? kind, string? key) => ControlledListAsync(db, null, kind, key, c));
        org.MapPost("", (ControlledUpload r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c) =>
            UploadAsync(h, db, audit, clock, null, r, c));
        org.MapPost("/{versionId:guid}/submit", SubmitAsync);
        org.MapPost("/{versionId:guid}/decide", DecideAsync);
        org.MapPost("/{versionId:guid}/discard", DiscardAsync);
    }

    private static Actor Who(ProjectAccess a) => new(a.UserId, a.UserName);

    /// <summary>The control function on this project, or whoever configures the organization.</summary>
    private static async Task<bool> KeepsAsync(HttpContext h, ProjectAccess a) => a.Holds(Verbs.Control) || await Keepers.ConfiguresAsync(h);

    private static IResult KeepersOnly(string what) => Problems.Forbidden("CONTROL_ONLY", $"The control function keeps {what}.");
}
