using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Notifications;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.Extensions.Options;
using NodaTime;

namespace Delios.Host.Transmittals;

/// <summary>
/// The reply address of one transmittal emailed to an organization not on DELIOS. Kept outside any organization's
/// data (no row-level security): a reply arrives before anyone knows whose it is, and this says where it belongs.
/// It holds only the key and where it leads.
/// </summary>
public sealed class ReplyAddress
{
    public required string Token { get; set; }
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid TransmittalId { get; set; }
    public Guid PartyId { get; set; }
    public Instant CreatedAt { get; set; }
}

/// <summary>
/// A reply by email to one of our transmittals, waiting for Document Control: recorded as received (a transmittal
/// that follows it, its files to check), or set aside with why. Nothing of it is filed by itself.
/// </summary>
public sealed class EmailReply
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid TransmittalId { get; set; }
    public Guid PartyId { get; set; }
    public required string FromAddress { get; set; }
    public string? FromName { get; set; }
    public required string Subject { get; set; }
    public required string Text { get; set; }
    public Instant ReceivedAt { get; set; }
    /// <summary>Its attachments, stored and not yet scanned: scanned once it is recorded.</summary>
    public Guid[] FileIds { get; set; } = [];
    public string State { get; set; } = EmailReplyStates.Waiting;
    public Guid? RecordedTransmittalId { get; set; }
    public string? HandledByName { get; set; }
    public Instant? HandledAt { get; set; }
    public string? SetAsideReason { get; set; }
}

public static class EmailReplyStates
{
    public const string Waiting = "WAITING";
    public const string Recorded = "RECORDED";
    public const string SetAside = "SET_ASIDE";
}

internal sealed class EmailReplyConfiguration : IEntityTypeConfiguration<ReplyAddress>, IEntityTypeConfiguration<EmailReply>
{
    public void Configure(EntityTypeBuilder<ReplyAddress> b)
    {
        b.HasKey(x => x.Token);
        b.Property(x => x.Token).HasMaxLength(32);
        b.HasIndex(x => x.TransmittalId);
    }

    public void Configure(EntityTypeBuilder<EmailReply> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.State });
        b.HasIndex(x => x.TransmittalId);
        b.Property(x => x.FromAddress).HasMaxLength(254);
        b.Property(x => x.FromName).HasMaxLength(200);
        b.Property(x => x.Subject).HasMaxLength(300);
        b.Property(x => x.Text).HasMaxLength(20000);
        b.Property(x => x.State).HasMaxLength(16);
        b.Property(x => x.HandledByName).HasMaxLength(200);
        b.Property(x => x.SetAsideReason).HasMaxLength(2000);
    }
}

/// <summary>One file that came with a reply, by name.</summary>
public sealed record EmailReplyFile(Guid Id, string Name, long Size);

/// <summary>A reply by email as Document Control reads it.</summary>
public sealed record EmailReplyView(Guid Id, Guid TransmittalId, string TransmittalNumber, string Organization, string FromAddress, string? FromName,
    string Subject, string Text, DateTimeOffset ReceivedAt, IReadOnlyList<EmailReplyFile> Files, string State, Guid? RecordedTransmittalId,
    string? HandledByName, DateTimeOffset? HandledAt, string? SetAsideReason);

/// <summary>Body of setting a reply aside: why it is not recorded.</summary>
public sealed record SetAsideRequest(string? Reason);

/// <summary>
/// Replies by email (docs/ORGANIZATIONS.md, "Not on DELIOS"). A transmittal to an organization nobody of which signs
/// in here is emailed to its contact address, with its files, and answers to an address of its own. A reply that
/// comes back from that address waits on the transmittal and on Document Control's Home: recorded as received it
/// becomes a transmittal that follows ours, its files checked as anything else that arrives; or it is set aside, with
/// why. Mail from anyone else, or to no transmittal, is not taken in: the sender is told how to answer.
/// </summary>
public sealed class EmailReplies(
    DeliosDbContext db, Notifier notifier, AuditLog audit, IClock clock, IOptions<EmailOptions> options,
    IServiceScopeFactory scopes, ILogger<EmailReplies> logger)
{
    private EmailOptions Email => options.Value;

    // ── Going out ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Emails a transmittal just raised to every organization it is addressed to that has a contact address and no
    /// one signing in for it: its text, its files attached (within the limit), and a reply address of its own. When
    /// transmittal email is on, the addressee reads as sent by email, to that address.
    /// </summary>
    public async Task SendToOrganizationsAsync(Project project, Transmittal transmittal, string text, CancellationToken cancellationToken)
    {
        var partyIds = transmittal.Recipients.Where(r => r.UserId is null && r.PartyId is not null).Select(r => r.PartyId!.Value).Distinct().ToList();
        if (partyIds.Count == 0) return;
        var parties = await db.Parties.AsNoTracking()
            .Where(p => partyIds.Contains(p.Id) && !p.IsInternal && p.Active && p.ContactEmail != null && p.ContactEmail != "").ToListAsync(cancellationToken);
        if (parties.Count == 0) return;
        var files = await FilesOfAsync(transmittal, cancellationToken);
        var size = files.Sum(f => f.Size);
        var attach = size <= Email.MaxAttachmentBytes;
        var now = clock.GetCurrentInstant();
        foreach (var party in parties)
        {
            string? replyTo = null;
            if (Email.Replies.On)
            {
                var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(12)).ToLowerInvariant();
                db.Add(new ReplyAddress { Token = token, TenantId = project.TenantId, ProjectId = project.Id, TransmittalId = transmittal.Id, PartyId = party.Id, CreatedAt = now });
                replyTo = Email.Replies.For(token);
            }
            var body = new StringBuilder(text);
            body.AppendLine().AppendLine();
            if (files.Count > 0)
                body.AppendLine(attach ? $"Files attached ({files.Count})." : $"The files ({files.Count}, {size / 1048576} MB) are too large to attach: Document Control sends them to you.");
            body.Append(replyTo is null
                ? "To answer, reply to Document Control."
                : "To answer, reply to this email, with your files attached. Your reply is kept with this transmittal. Anything else: write to us as usual.");
            notifier.Queue(project.TenantId, project.Id, EmailKinds.Transmittal, party.ContactEmail!, party.Name,
                $"{transmittal.Number}: {transmittal.Subject}", body.ToString(), "Transmittal", transmittal.Id, replyTo,
                attach ? [.. files.Select(f => f.Id)] : []);
            // Sent by email when email is on; otherwise one of ours still sends it, as before.
            if (Email.Sends(EmailKinds.Transmittal) && attach)
            {
                foreach (var to in transmittal.Recipients.Where(r => r.UserId is null && r.PartyId == party.Id && r.DispatchedAt is null))
                {
                    to.DispatchedAt = now;
                    to.DispatchChannel = "EMAIL";
                    to.DispatchRef = party.ContactEmail;
                    to.DispatchedByName = "DELIOS";
                }
            }
        }
    }

    /// <summary>The files a transmittal carries: each revision's released copy (stamped where there is one) and its native file.</summary>
    private async Task<List<StoredFile>> FilesOfAsync(Transmittal transmittal, CancellationToken cancellationToken)
    {
        var revisionIds = transmittal.Items.Where(i => i.RevisionId is not null).Select(i => i.RevisionId!.Value).ToList();
        if (revisionIds.Count == 0) return [];
        var all = await db.StoredFiles.AsNoTracking()
            .Where(f => f.RevisionId != null && revisionIds.Contains(f.RevisionId.Value) && f.Status == FileStatuses.Clean
                && (f.Kind == FileKinds.Stamped || f.Kind == FileKinds.Rendition || f.Kind == FileKinds.Native))
            .ToListAsync(cancellationToken);
        return all.GroupBy(f => f.RevisionId).SelectMany(g =>
        {
            var latest = g.Max(f => f.Submission);
            var current = g.Where(f => f.Submission == latest || f.Kind == FileKinds.Stamped).ToList();
            var stamped = current.Where(f => f.Kind == FileKinds.Stamped).OrderByDescending(f => f.CreatedAt).Take(1).ToList();
            return stamped.Concat(current.Where(f => f.Kind == FileKinds.Native || (stamped.Count == 0 && f.Kind == FileKinds.Rendition)));
        }).ToList();
    }

    // ── Coming in ─────────────────────────────────────────────────────────────

    /// <summary>
    /// A reply passed on by the mail provider (JSON: from, to, subject, text, attachments with base64 content; the
    /// provider's own field names are read too). Taken in only when it is addressed to a transmittal's reply address
    /// and comes from that organization's contact address; otherwise its sender is told how to answer.
    /// </summary>
    public async Task<IResult> ReceiveAsync(HttpContext http, CancellationToken cancellationToken)
    {
        var secret = http.Request.Headers["X-Delios-Secret"].ToString();
        if (!Email.Replies.On || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(Email.Replies.Secret)))
            return Results.NotFound();
        JsonElement mail;
        try { mail = (await JsonDocument.ParseAsync(http.Request.Body, cancellationToken: cancellationToken)).RootElement; }
        catch (JsonException) { return Results.BadRequest(); }

        var from = Address(Read(mail, "from", "From") ?? Read(mail, "FromFull.Email") ?? "");
        var fromName = Read(mail, "fromName", "FromName");
        var to = new[] { Read(mail, "to", "To"), Read(mail, "OriginalRecipient"), Read(mail, "recipient") }.Where(x => x is not null).Select(x => x!).ToList();
        var subject = Read(mail, "subject", "Subject") ?? "";
        var text = Read(mail, "text", "StrippedTextReply", "TextBody", "body-plain") ?? "";
        var token = to.SelectMany(x => x.Split(',', ';')).Select(TokenOf).FirstOrDefault(t => t is not null);
        var route = token is null ? null : await db.Set<ReplyAddress>().AsNoTracking().SingleOrDefaultAsync(r => r.Token == token, cancellationToken);
        if (route is null)
        {
            // To no transmittal: nothing is taken in. Who sent it cannot be answered from an organization we do not know.
            logger.LogInformation("A reply by email to no known transmittal was not taken in");
            return Results.Accepted();
        }

        var attachments = Attachments(mail);
        await TenantScope.RunAsync(scopes, route.TenantId, async (services, here) =>
        {
            var party = await here.Parties.AsNoTracking().SingleAsync(p => p.Id == route.PartyId, cancellationToken);
            var transmittal = await here.Transmittals.AsNoTracking().SingleAsync(t => t.Id == route.TransmittalId, cancellationToken);
            var mailer = services.GetRequiredService<Notifier>();
            if (!string.Equals(from, party.ContactEmail?.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                // Not from the address we wrote to: not taken in, and its sender is told why.
                if (from.Contains('@'))
                    mailer.Queue(route.TenantId, route.ProjectId, EmailKinds.Transmittal, from, fromName, $"Not received: {subject}",
                        $"Your email to the reply address of {transmittal.Number} was not taken in: that address takes replies from {party.Name}'s "
                        + "address we wrote to only. Please ask them to reply, or write to Document Control.", "Transmittal", transmittal.Id);
                await here.SaveChangesAsync(cancellationToken);
                return;
            }
            var now = services.GetRequiredService<IClock>().GetCurrentInstant();
            var reply = new EmailReply
            {
                TenantId = route.TenantId, ProjectId = route.ProjectId, TransmittalId = transmittal.Id, PartyId = party.Id,
                FromAddress = from, FromName = Clip(fromName, 200), Subject = Clip(subject, 300) ?? "", Text = Clip(text.Trim(), 20000) ?? "", ReceivedAt = now,
            };
            var store = services.GetRequiredService<FileStorage>();
            var limit = services.GetRequiredService<IOptions<StorageOptions>>().Value.MaxFileBytes;
            var kept = new List<Guid>();
            foreach (var (name, contentType, bytes) in attachments.Where(a => a.Bytes.Length > 0 && a.Bytes.Length <= limit).Take(50))
            {
                var file = new StoredFile
                {
                    TenantId = route.TenantId, ProjectId = route.ProjectId, ObjectKey = "", Name = Clip(name, 200) ?? "file",
                    ContentType = string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType,
                    Size = bytes.Length, Sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
                    Kind = name.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) ? FileKinds.Rendition : FileKinds.Native,
                    UploadedById = Guid.Empty, UploadedByName = $"{party.Name}, by email", CreatedAt = now,
                };
                file.ObjectKey = FileStorage.KeyFor(file.TenantId, file.ProjectId, file.Id);
                await store.PutAsync(file.ObjectKey, bytes, file.ContentType, cancellationToken);
                here.StoredFiles.Add(file);
                kept.Add(file.Id);
            }
            reply.FileIds = [.. kept];
            here.Add(reply);
            await services.GetRequiredService<AuditLog>().WriteAsync(Actor.System, "EMAIL_REPLY_RECEIVED", "Transmittal", transmittal.Id, transmittal.Number,
                $"Reply by email from {party.Name} ({from}), {kept.Count} file(s); waiting for Document Control.", route.ProjectId, cancellationToken);
            await mailer.NotifyAsync(route.TenantId, route.ProjectId, await mailer.ControlHoldersAsync(route.ProjectId, cancellationToken),
                NotificationKinds.IncomingArrived, $"{transmittal.Number}: {party.Name} replied by email",
                $"{subject}\n{(kept.Count == 0 ? "No files." : $"{kept.Count} file(s).")} Record it as received, or set it aside.",
                $"/transmittals/{transmittal.Id}#email-replies", cancellationToken);
            await here.SaveChangesAsync(cancellationToken);
        }, cancellationToken);
        return Results.Accepted();
    }

    // ── Document Control's answer ─────────────────────────────────────────────

    /// <summary>The replies by email on one transmittal, or (no transmittal) those waiting on the project.</summary>
    public async Task<List<EmailReplyView>> ListAsync(ProjectAccess access, Guid? transmittalId, CancellationToken cancellationToken)
    {
        var query = db.Set<EmailReply>().AsNoTracking().Where(r => r.ProjectId == access.Project.Id);
        query = transmittalId is { } id ? query.Where(r => r.TransmittalId == id) : query.Where(r => r.State == EmailReplyStates.Waiting);
        var rows = await query.OrderByDescending(r => r.ReceivedAt).Take(200).ToListAsync(cancellationToken);
        var fileIds = rows.SelectMany(r => r.FileIds).ToList();
        var files = await db.StoredFiles.AsNoTracking().Where(f => fileIds.Contains(f.Id)).ToDictionaryAsync(f => f.Id, cancellationToken);
        var transmittalIds = rows.Select(r => r.TransmittalId).Distinct().ToList();
        var numbers = await db.Transmittals.AsNoTracking().Where(t => transmittalIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => t.Number, cancellationToken);
        var partyIds = rows.Select(r => r.PartyId).Distinct().ToList();
        var names = await db.Parties.AsNoTracking().Where(p => partyIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);
        return rows.Select(r => new EmailReplyView(r.Id, r.TransmittalId, numbers.GetValueOrDefault(r.TransmittalId, ""), names.GetValueOrDefault(r.PartyId, ""),
            r.FromAddress, r.FromName, r.Subject, r.Text, r.ReceivedAt.ToDateTimeOffset(),
            r.FileIds.Where(files.ContainsKey).Select(f => new EmailReplyFile(f, files[f].Name, files[f].Size)).ToList(),
            r.State, r.RecordedTransmittalId, r.HandledByName, r.HandledAt?.ToDateTimeOffset(), r.SetAsideReason)).ToList();
    }

    /// <summary>
    /// Document Control records a reply as received: a transmittal from that organization following ours, its words
    /// the message, each file an item to check, received the day the email came.
    /// </summary>
    public async Task<(Guid? TransmittalId, IResult? Problem)> RecordAsync(ProjectAccess access, IncomingService incoming, Guid replyId,
        CancellationToken cancellationToken)
    {
        if (!access.Holds(Verbs.Control)) return (null, Problems.Forbidden("CONTROL_ONLY", "Document Control records what arrived."));
        var reply = await db.Set<EmailReply>().SingleOrDefaultAsync(r => r.Id == replyId && r.ProjectId == access.Project.Id, cancellationToken);
        if (reply is null) return (null, Problems.NotFound("REPLY_NOT_FOUND", "No such reply."));
        if (reply.State != EmailReplyStates.Waiting) return (null, Problems.Conflict("REPLY_HANDLED", "This reply was already answered."));
        // Recorded by Document Control: the files are theirs to hand to the check.
        var files = await db.StoredFiles.Where(f => reply.FileIds.Contains(f.Id)).ToListAsync(cancellationToken);
        foreach (var file in files) file.UploadedById = access.UserId;
        await db.SaveChangesAsync(cancellationToken);
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var reason = catalog.IsActive(TransmittalSets.Reasons, "ANSWER") ? "ANSWER"
            : catalog.Active(TransmittalSets.Reasons).Select(v => v.Code).FirstOrDefault() ?? "";
        var day = reply.ReceivedAt.InZone(DateTimeZoneProviders.Tzdb.GetZoneOrNull(access.Project.TimeZone) ?? DateTimeZone.Utc).Date.ToDateOnly();
        var message = string.IsNullOrWhiteSpace(reply.Text) ? $"Reply by email: {reply.Subject}" : reply.Text;
        var (recorded, problem) = await incoming.SendAsync(access, new IncomingRequest(
            reason, Subject: reply.Subject, Message: message,
            Unplanned: files.Select(f => new UnplannedItem(f.Name, null, null, [f.Id])).ToArray(),
            FromPartyId: reply.PartyId, Note: $"Replied by email from {reply.FromAddress}.", ReceivedOn: day, InReplyToId: reply.TransmittalId),
            cancellationToken);
        if (problem is not null) return (null, problem);
        reply.State = EmailReplyStates.Recorded;
        reply.RecordedTransmittalId = recorded!.Id;
        reply.HandledByName = access.UserName;
        reply.HandledAt = clock.GetCurrentInstant();
        await db.SaveChangesAsync(cancellationToken);
        return (recorded.Id, null);
    }

    /// <summary>Document Control sets a reply aside, with why: not about this transmittal, a mistake, a duplicate. It is kept.</summary>
    public async Task<IResult?> SetAsideAsync(ProjectAccess access, Guid replyId, SetAsideRequest request, CancellationToken cancellationToken)
    {
        if (!access.Holds(Verbs.Control)) return Problems.Forbidden("CONTROL_ONLY", "Document Control answers what arrived.");
        var why = request.Reason?.Trim() ?? "";
        if (why.Length == 0) return Problems.Invalid("REASON_REQUIRED", "Say why it is set aside.");
        var reply = await db.Set<EmailReply>().SingleOrDefaultAsync(r => r.Id == replyId && r.ProjectId == access.Project.Id, cancellationToken);
        if (reply is null) return Problems.NotFound("REPLY_NOT_FOUND", "No such reply.");
        if (reply.State != EmailReplyStates.Waiting) return Problems.Conflict("REPLY_HANDLED", "This reply was already answered.");
        reply.State = EmailReplyStates.SetAside;
        reply.SetAsideReason = why.Length > 2000 ? why[..2000] : why;
        reply.HandledByName = access.UserName;
        reply.HandledAt = clock.GetCurrentInstant();
        var number = await db.Transmittals.Where(t => t.Id == reply.TransmittalId).Select(t => t.Number).SingleAsync(cancellationToken);
        await audit.WriteAsync(new Actor(access.UserId, access.UserName), "EMAIL_REPLY_SET_ASIDE", "Transmittal", reply.TransmittalId, number,
            $"Reply by email from {reply.FromAddress} set aside: {why}", access.Project.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return null;
    }

    // ── Reading an email ──────────────────────────────────────────────────────

    /// <summary>The first of these fields present, as text ("A.B" reads a field inside another).</summary>
    private static string? Read(JsonElement mail, params string[] names)
    {
        foreach (var name in names)
        {
            var at = mail;
            var found = true;
            foreach (var part in name.Split('.'))
            {
                if (at.ValueKind != JsonValueKind.Object || !at.TryGetProperty(part, out at)) { found = false; break; }
            }
            if (found && at.ValueKind == JsonValueKind.String && at.GetString() is { Length: > 0 } value) return value;
        }
        return null;
    }

    /// <summary>The bare address in "Name &lt;address&gt;".</summary>
    private static string Address(string text)
    {
        var open = text.IndexOf('<');
        var close = text.IndexOf('>');
        return (open >= 0 && close > open ? text[(open + 1)..close] : text).Trim().ToLowerInvariant();
    }

    /// <summary>The key after the plus in a reply address, when it looks like one of ours.</summary>
    private static string? TokenOf(string address)
    {
        var bare = Address(address);
        var plus = bare.IndexOf('+');
        var at = bare.IndexOf('@');
        if (plus < 0 || at < plus) return null;
        var token = bare[(plus + 1)..at];
        return token.Length == 24 && token.All(Uri.IsHexDigit) ? token : null;
    }

    private static List<(string Name, string ContentType, byte[] Bytes)> Attachments(JsonElement mail)
    {
        var found = new List<(string, string, byte[])>();
        foreach (var key in new[] { "attachments", "Attachments" })
        {
            if (!mail.TryGetProperty(key, out var list) || list.ValueKind != JsonValueKind.Array) continue;
            foreach (var one in list.EnumerateArray())
            {
                var content = Read(one, "content", "Content");
                if (content is null) continue;
                try
                {
                    found.Add((Read(one, "name", "Name", "filename") ?? "file", Read(one, "contentType", "ContentType") ?? "", Convert.FromBase64String(content)));
                }
                catch (FormatException) { }
            }
        }
        return found;
    }

    private static string? Clip(string? text, int length) => text is null ? null : text.Length <= length ? text : text[..(length - 1)] + "…";
}

/// <summary>The door replies by email come in by, and Document Control's answer to each.</summary>
public static class EmailReplyEndpoints
{
    public static void MapEmailReplyEndpoints(IEndpointRouteBuilder app)
    {
        // Called by the mail provider, with the shared secret; no one signs in.
        app.MapPost("/api/inbound/email", (HttpContext http, EmailReplies replies, CancellationToken c) => replies.ReceiveAsync(http, c))
            .WithTags("Transmittals").AllowAnonymous();

        var project = app.MapGroup("/api/projects/{projectId:guid}").WithTags("Transmittals")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("/email-replies", async (HttpContext http, EmailReplies replies, CancellationToken c, Guid? transmittalId = null) =>
        {
            var access = ProjectAccessFilter.Of(http);
            return access.Holds(Verbs.Control) ? Results.Ok(await replies.ListAsync(access, transmittalId, c)) : Results.Ok(Array.Empty<EmailReplyView>());
        });
        project.MapPost("/email-replies/{replyId:guid}/record", async (Guid replyId, HttpContext http, EmailReplies replies, IncomingService incoming,
            CancellationToken c) =>
        {
            var (id, problem) = await replies.RecordAsync(ProjectAccessFilter.Of(http), incoming, replyId, c);
            return problem ?? Results.Ok(new { transmittalId = id });
        });
        project.MapPost("/email-replies/{replyId:guid}/set-aside", async (Guid replyId, SetAsideRequest request, HttpContext http, EmailReplies replies,
            CancellationToken c) => await replies.SetAsideAsync(ProjectAccessFilter.Of(http), replyId, request, c) ?? Results.NoContent());
    }
}
