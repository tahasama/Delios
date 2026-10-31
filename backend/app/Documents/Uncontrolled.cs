using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Documents;

/// <summary>
/// The uncontrolled documents (owner: "we will just keep them if we receive in a transmittal… clearly marked uncontrolled"):
/// every file the project keeps that is not in the register, each with where it came from, who sent it and when, and a
/// link to that place. Nothing is stored for it: each line is read from where its file already sits. Its type says how
/// it came (owner: "you can make those types of docs for uncontrolled docs"); the types are worked out, never kept.
/// Our people only, each reading what they may open of the transmittals.
/// </summary>
public static class Uncontrolled
{
    /// <summary>How an uncontrolled document came, worked out on reading.</summary>
    public static class Types
    {
        /// <summary>Came on a transmittal and was never registered nor matched to one of ours.</summary>
        public const string Received = "RECEIVED";
        /// <summary>Kept with something received, after it was recorded (a join request's letter among them).</summary>
        public const string KeptWith = "KEPT_WITH";
        /// <summary>The covering letter or email of what came from outside the system.</summary>
        public const string CoveringLetter = "COVERING_LETTER";
        /// <summary>The proof that something of ours went outside the system.</summary>
        public const string SentProof = "SENT_PROOF";
        /// <summary>The proof of an answer one of ours recorded for another organization.</summary>
        public const string AnswerProof = "ANSWER_PROOF";
        /// <summary>The files of a reply by email set aside, never recorded as a transmittal.</summary>
        public const string EmailReply = "EMAIL_REPLY";
        /// <summary>A list file uploaded on the Schedule, kept as the file that was read.</summary>
        public const string ListFile = "LIST_FILE";
    }

    /// <summary>One uncontrolled document: its file (none for a list file), what it is, where it came from and when.</summary>
    public sealed record Row(Guid? FileId, string Name, long? Size, string Type, string Came, string Href, string? From,
        string? By, DateTimeOffset At, string? Note);

    /// <summary>Maps <c>GET /api/projects/{projectId}/uncontrolled</c>.</summary>
    public static void MapUncontrolledEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGroup("/api/projects/{projectId:guid}").WithTags("Documents")
            .AddEndpointFilter<TransactionFilter>()
            .AddEndpointFilter<ProjectAccessFilter>()
            .MapGet("/uncontrolled", ListAsync);
    }

    private const int Most = 5000;

    private static async Task<IResult> ListAsync(HttpContext http, DeliosDbContext db, TransmittalService transmittals, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        if (!access.IsInternal || !access.Holds(Verbs.Read)) return Problems.NotFound("NOT_FOUND", "Nothing here for you.");
        var projectId = access.Project.Id;
        var visible = transmittals.Visible(access).Select(t => t.Id);
        var rows = new List<Row>();

        // On a transmittal: items never registered nor matched, and files kept with what arrived.
        var items = await (
            from i in db.TransmittalItems.AsNoTracking()
            join t in db.Transmittals.AsNoTracking() on i.TransmittalId equals t.Id
            where visible.Contains(t.Id)
                && ((i.Kind == TransmittalItemKinds.Unplanned && i.DocumentId == null && !i.Matched) || i.Kind == TransmittalItemKinds.Attachment)
            join f in db.StoredFiles.AsNoTracking() on i.Id equals f.TransmittalItemId
            where f.ProjectId == projectId
            select new { f.Id, f.Name, f.Size, i.Kind, i.DocumentNumber, i.ReturnedAt, i.ReturnedReason, TransmittalId = t.Id, t.Number, t.Subject, t.FromName, t.IssuedByName, t.IssuedAt })
            .Take(Most).ToListAsync(cancellationToken);
        foreach (var x in items)
        {
            var received = x.Kind == TransmittalItemKinds.Unplanned;
            rows.Add(new Row(x.Id, x.Name, x.Size, received ? Types.Received : Types.KeptWith, $"{x.Number} · {x.Subject}",
                $"/transmittals/{x.TransmittalId}", x.FromName, x.IssuedByName, x.IssuedAt.ToDateTimeOffset(),
                received
                    ? x.ReturnedAt is not null ? $"Returned by the check: {x.ReturnedReason}" : string.IsNullOrWhiteSpace(x.DocumentNumber) ? null : $"Their reference: {x.DocumentNumber}"
                    : null));
        }

        // Covering letters of what came from outside the system.
        var letters = await (
            from t in db.Transmittals.AsNoTracking()
            where visible.Contains(t.Id) && t.ProofFileId != null
            join f in db.StoredFiles.AsNoTracking() on t.ProofFileId equals f.Id
            select new { FileId = f.Id, f.Name, f.Size, TransmittalId = t.Id, t.Number, t.Subject, t.FromName, t.IssuedByName, t.IssuedAt })
            .Take(Most).ToListAsync(cancellationToken);
        rows.AddRange(letters.Select(x => new Row(x.FileId, x.Name, x.Size, Types.CoveringLetter, $"{x.Number} · {x.Subject}",
            $"/transmittals/{x.TransmittalId}", x.FromName, x.IssuedByName, x.IssuedAt.ToDateTimeOffset(), null)));

        // Proof that something of ours went outside the system.
        var sent = await (
            from r in db.TransmittalRecipients.AsNoTracking()
            where visible.Contains(r.TransmittalId) && r.ProofFileId != null
            join t in db.Transmittals.AsNoTracking() on r.TransmittalId equals t.Id
            join f in db.StoredFiles.AsNoTracking() on r.ProofFileId equals f.Id
            select new { f.Id, f.Name, f.Size, TransmittalId = t.Id, t.Number, t.Subject, ToName = r.Organization ?? r.Name, r.DispatchChannel, r.DispatchedByName, r.DispatchedAt, f.CreatedAt })
            .Take(Most).ToListAsync(cancellationToken);
        rows.AddRange(sent.Select(x => new Row(x.Id, x.Name, x.Size, Types.SentProof, $"{x.Number} · {x.Subject}",
            $"/transmittals/{x.TransmittalId}", null, x.DispatchedByName, (x.DispatchedAt ?? x.CreatedAt).ToDateTimeOffset(),
            $"Sent to {x.ToName}{(string.IsNullOrWhiteSpace(x.DispatchChannel) ? "" : $" by {x.DispatchChannel}")}")));

        // Proof of an answer one of ours recorded for another organization.
        var answers = await (
            from s in db.ReviewSteps.AsNoTracking()
            where s.EvidenceFileId != null
            join r in db.Reviews.AsNoTracking() on s.ReviewId equals r.Id
            where r.ProjectId == projectId
            join f in db.StoredFiles.AsNoTracking() on s.EvidenceFileId equals f.Id
            select new { f.Id, f.Name, f.Size, ReviewId = r.Id, r.Number, s.Title, s.RecordedByName, s.CompletedAt, f.CreatedAt })
            .Take(Most).ToListAsync(cancellationToken);
        rows.AddRange(answers.Select(x => new Row(x.Id, x.Name, x.Size, Types.AnswerProof, $"{x.Number} · {x.Title}",
            $"/reviews/{x.ReviewId}", null, x.RecordedByName, (x.CompletedAt ?? x.CreatedAt).ToDateTimeOffset(), null)));

        // Replies by email set aside, never recorded as a transmittal.
        var replies = await db.EmailReplies.AsNoTracking()
            .Where(e => e.ProjectId == projectId && e.State == EmailReplyStates.SetAside && visible.Contains(e.TransmittalId))
            .Join(db.Transmittals.AsNoTracking(), e => e.TransmittalId, t => t.Id, (e, t) => new { e, t.Number })
            .Take(Most).ToListAsync(cancellationToken);
        var replyFiles = replies.SelectMany(x => x.e.FileIds).ToList();
        var files = await db.StoredFiles.AsNoTracking().Where(f => replyFiles.Contains(f.Id) && f.ProjectId == projectId)
            .Select(f => new { f.Id, f.Name, f.Size }).ToDictionaryAsync(f => f.Id, cancellationToken);
        foreach (var x in replies)
            foreach (var id in x.e.FileIds)
                if (files.TryGetValue(id, out var f))
                    rows.Add(new Row(f.Id, f.Name, f.Size, Types.EmailReply, $"A reply to {x.Number} · {x.e.Subject}",
                        $"/transmittals/{x.e.TransmittalId}", x.e.FromName ?? x.e.FromAddress, x.e.FromName ?? x.e.FromAddress,
                        x.e.ReceivedAt.ToDateTimeOffset(), $"Set aside by {x.e.HandledByName}: {x.e.SetAsideReason}"));

        // List files uploaded on the Schedule (a list read from its register document is that document's file: controlled).
        var lists = await db.Set<Records.ControlledVersion>().AsNoTracking()
            .Where(v => v.ProjectId == projectId && v.ObjectKey != null)
            .Select(v => new { v.SourceName, v.SourceSize, v.Title, v.VersionLabel, v.CreatedByName, v.CreatedAt, v.DecisionReason })
            .Take(Most).ToListAsync(cancellationToken);
        rows.AddRange(lists.Select(x => new Row(null, x.SourceName ?? x.Title, x.SourceSize, Types.ListFile, $"{x.Title} · {x.VersionLabel}",
            "/schedule", null, x.CreatedByName, x.CreatedAt.ToDateTimeOffset(), x.DecisionReason is null ? null : $"Why: {x.DecisionReason}")));

        return Results.Ok(rows.OrderByDescending(r => r.At).Take(Most));
    }
}
