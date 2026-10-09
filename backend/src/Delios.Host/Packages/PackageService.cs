using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Packages;

/// <summary>The rule sent by the browser: lists of codes to match documents on. Every list may be left out.</summary>
public sealed record RuleRequest(string[]? DeliverableTypes = null, string[]? Disciplines = null, string[]? DocTypes = null,
    string[]? Originators = null, Guid[]? AssetIds = null);

/// <summary>Body of the create-package request.</summary>
public sealed record CreatePackageRequest(
    string? Title, string? Reason, string[]? RequiredStatuses, Guid[]? OwnerIds, Guid[]? AcceptorIds,
    Guid[]? RecipientPartyIds = null, string? Description = null, DateOnly? CompletionDate = null, RuleRequest? Rule = null,
    string? Kind = null, Guid? SupplierPartyId = null, string? PurchaseOrder = null, string[]? Reasons = null,
    Dictionary<string, string?>? Extras = null);

/// <summary>Body of renaming a package.</summary>
public sealed record RenameRequest(string? Title, string? Description = null);

/// <summary>Body of asking a supplier for the placeholders of a supply package not asked for yet.</summary>
public sealed record SupplyRequest(string? Message = null);

/// <summary>
/// Body for adding or removing documents. <c>RequiredStatuses</c> applies only to the documents being added.
/// </summary>
public sealed record MembersRequest(Guid[]? DocumentIds, string[]? RequiredStatuses = null);
/// <summary>
/// Body of the deliver request. <c>RuleCeased</c> must be true when the package has a rule: the owners confirm nothing
/// more will join.
/// </summary>
public sealed record DeliverRequest(bool RuleCeased = false, string? Note = null);
/// <summary>A request body that carries only an optional note for the audit log.</summary>
public sealed record NoteRequest(string? Note = null);

/// <summary>
/// Packages: composing a set of documents, assessing whether each has reached
/// the status it needs, the shortfall the acceptance authority accepts or not,
/// delivery on transmittals, and acceptance. Delivering fixes the contents.
/// </summary>
public sealed class PackageService(
    DeliosDbContext db, Numbering numbering, TransmittalService transmittals, AuditLog audit, IClock clock)
{
    // ── Composing ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Creates a package after checking the caller may, the reason and statuses are published values, owners and
    /// acceptors are different people on the project, and the recipient organizations exist. Documents matching the
    /// rule join at once.
    /// </summary>
    public async Task<(Package? Package, IResult? Problem)> CreateAsync(
        ProjectAccess access, CreatePackageRequest request, CancellationToken cancellationToken)
    {
        if (!access.IsInternal || !(access.Holds(Verbs.Create) || access.Holds(Verbs.Transmit) || access.Holds(Verbs.Control)))
            return Fail(Problems.Forbidden("PACKAGE_NOT_ALLOWED", "Your function on this project does not put packages together."));
        var title = request.Title?.Trim() ?? "";
        if (title.Length == 0) return Fail(Problems.Invalid("TITLE_REQUIRED", "Give the package a title."));

        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        // One reason or several: the first leads its transmittals, the others are named on them.
        var reasons = (request.Reasons is { Length: > 0 } many ? many : [request.Reason ?? ""]).Select(r => r.Trim()).Distinct().ToArray();
        var reason = reasons[0];
        if (reasons.FirstOrDefault(r => !catalog.IsActive(TransmittalSets.Reasons, r)) is { } badReason)
        {
            return Fail(Problems.Invalid("VALUE_NOT_PUBLISHED", $"{badReason} is not a published reason for issue.",
                new { field = "reason", value = badReason }));
        }
        if (StatusesProblem(catalog, request.RequiredStatuses, required: true) is { } badStatus) return Fail(badStatus);

        var owners = request.OwnerIds?.Distinct().ToArray() ?? [];
        var acceptors = request.AcceptorIds?.Distinct().ToArray() ?? [];
        if (owners.Length == 0 || acceptors.Length == 0)
            return Fail(Problems.Invalid("ROLES_REQUIRED", "Name who puts it together and who accepts it."));
        // Nobody accepts their own work.
        if (owners.Intersect(acceptors).Any())
            return Fail(Problems.Invalid("ACCEPTOR_IS_OWNER", "Whoever accepts a package is never one of the people who put it together."));
        var members = (await transmittals.MembersAsync(access.Project, cancellationToken)).Where(m => m.Internal)
            .Select(m => m.UserId).ToHashSet();
        var strangers = owners.Concat(acceptors).Where(id => !members.Contains(id)).ToList();
        if (strangers.Count > 0)
            return Fail(Problems.Invalid("PERSON_NOT_ON_PROJECT", "Some people named are not ours on this project.", new { userIds = strangers }));

        var kind = request.Kind ?? PackageKinds.Delivery;
        if (kind is not (PackageKinds.Delivery or PackageKinds.Supply))
            return Fail(Problems.Invalid("KIND_UNKNOWN", "A package is a delivery or a supply.", new { kind }));
        Party? supplier = null;
        var rule = request.Rule;
        var recipients = request.RecipientPartyIds?.Distinct().ToArray() ?? [];
        if (kind == PackageKinds.Supply)
        {
            supplier = request.SupplierPartyId is { } supplierId
                ? await db.Parties.AsNoTracking().SingleOrDefaultAsync(p => p.Id == supplierId && p.Active && !p.IsInternal, cancellationToken)
                : null;
            if (supplier is null) return Fail(Problems.Invalid("SUPPLIER_REQUIRED", "Say which outside organization owes these documents."));
            if (Blank(request.PurchaseOrder) is { } order && !catalog.IsActive(ValueSets.PurchaseOrders, order))
            {
                return Fail(Problems.Invalid("VALUE_NOT_PUBLISHED", $"{order} is not a published purchase order.",
                    new { field = "purchaseOrder", value = order }));
            }
            // A supply package holds what its supplier produces, and nothing else; nothing is delivered from it.
            rule = (rule ?? new RuleRequest()) with { Originators = [supplier.Code] };
            recipients = [];
        }
        var known = await db.Parties.AsNoTracking().Where(p => recipients.Contains(p.Id) && p.Active).CountAsync(cancellationToken);
        if (known != recipients.Length)
            return Fail(Problems.Invalid("PARTY_UNKNOWN", "Some organizations named are not active parties."));
        if ((RuleProblem(catalog, rule) ?? await OriginatorsProblemAsync(rule, cancellationToken)) is { } badRule) return Fail(badRule);

        var now = clock.GetCurrentInstant();
        var package = new Package
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            Number = await numbering.RecordAsync(access.Project.TenantId, access.Project.Id, RecordKinds.Package,
                NumberFields.ForRecord(access.Project.Code), "PK", cancellationToken),
            Kind = kind,
            SupplierPartyId = supplier?.Id,
            PurchaseOrder = Blank(request.PurchaseOrder),
            Title = title,
            Description = Blank(request.Description),
            Reason = reason,
            OtherReasons = reasons[1..],
            Extras = Documents.OwnFields.Write(null, request.Extras),
            RequiredStatuses = request.RequiredStatuses!.Distinct().ToArray(),
            CompletionDate = request.CompletionDate is { } d ? LocalDate.FromDateOnly(d) : null,
            Rule = ToRule(rule),
            RecipientPartyIds = recipients,
            OwnerIds = owners,
            AcceptorIds = acceptors,
            CreatedById = access.UserId,
            CreatedByName = access.UserName,
            CreatedAt = now,
        };
        db.Packages.Add(package);
        var joined = await SyncAsync(package, cancellationToken);
        await audit.WriteAsync(Actor(access), "PACKAGE_CREATED", "Package", package.Id, package.Number,
            package.Rule is null ? $"{title}: documents added by hand." : $"{title}: fills itself by its rule; {joined} document(s) now.",
            access.Project.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, null);
    }

    /// <summary>
    /// Adds documents by hand. A document taken out earlier comes back and is no longer excluded. Any earlier
    /// assessment is cleared.
    /// </summary>
    public async Task<(Package? Package, IResult? Problem)> AddAsync(
        ProjectAccess access, Guid id, MembersRequest request, CancellationToken cancellationToken)
    {
        var (package, problem) = await ComposableAsync(access, id, cancellationToken);
        if (problem is not null) return Fail(problem);
        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        if (StatusesProblem(catalog, request.RequiredStatuses, required: false) is { } badStatus) return Fail(badStatus);
        var ids = request.DocumentIds?.Distinct().ToList() ?? [];
        if (ids.Count == 0) return Fail(Problems.Invalid("DOCUMENTS_REQUIRED", "Say which documents to add."));
        var found = await db.Documents.AsNoTracking().Where(d => ids.Contains(d.Id) && d.ProjectId == package!.ProjectId)
            .Select(d => new { d.Id, d.Originator }).ToListAsync(cancellationToken);
        if (found.Count != ids.Count)
            return Fail(Problems.Invalid("DOCUMENT_NOT_FOUND", "Some documents are not on this project.", new { documentIds = ids.Except(found.Select(f => f.Id)) }));
        if (await SupplierCodeAsync(package!, cancellationToken) is { } supplierCode && found.Any(f => f.Originator != supplierCode))
        {
            return Fail(Problems.Invalid("NOT_THE_SUPPLIERS", $"A supply package holds only what {supplierCode} produces.",
                new { documentIds = found.Where(f => f.Originator != supplierCode).Select(f => f.Id) }));
        }

        var have = package!.Members.Select(m => m.DocumentId).ToHashSet();
        var fresh = ids.Where(i => !have.Contains(i)).ToList();
        if (fresh.Count == 0) return Fail(Problems.Conflict("ALREADY_MEMBERS", "Those documents are already in the package."));
        foreach (var documentId in fresh)
        {
            package.Members.Add(NewMember(package, documentId, request.RequiredStatuses?.Distinct().ToArray() ?? [], byRule: false));
        }
        // Put back by hand: the rule's exclusion no longer applies.
        package.Excluded = package.Excluded.Except(fresh).ToArray();
        ResetAssessment(package);
        await audit.WriteAsync(Actor(access), "PACKAGE_MEMBERS_ADDED", "Package", package.Id, package.Number,
            $"{fresh.Count} document(s) added.", package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, null);
    }

    /// <summary>Take documents out. One the rule matches stays out.</summary>
    public async Task<(Package? Package, IResult? Problem)> RemoveAsync(
        ProjectAccess access, Guid id, MembersRequest request, CancellationToken cancellationToken)
    {
        var (package, problem) = await ComposableAsync(access, id, cancellationToken);
        if (problem is not null) return Fail(problem);
        var ids = request.DocumentIds?.ToHashSet() ?? [];
        var going = package!.Members.Where(m => ids.Contains(m.DocumentId)).ToList();
        if (going.Count == 0) return Fail(Problems.Invalid("DOCUMENTS_REQUIRED", "Say which documents to take out."));
        foreach (var member in going) package.Members.Remove(member);
        db.PackageMembers.RemoveRange(going);
        package.Excluded = package.Excluded.Union(going.Select(m => m.DocumentId)).ToArray();
        ResetAssessment(package);
        await audit.WriteAsync(Actor(access), "PACKAGE_MEMBERS_REMOVED", "Package", package.Id, package.Number,
            $"{going.Count} document(s) taken out.", package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, null);
    }

    /// <summary>Set, change or clear the rule it fills itself by. A document that stops matching stays: it was promised.</summary>
    public async Task<(Package? Package, IResult? Problem)> SetRuleAsync(
        ProjectAccess access, Guid id, RuleRequest? request, CancellationToken cancellationToken)
    {
        var (package, problem) = await ComposableAsync(access, id, cancellationToken);
        if (problem is not null) return Fail(problem);
        if (await SupplierCodeAsync(package!, cancellationToken) is { } supplierCode)
            request = (request ?? new RuleRequest()) with { Originators = [supplierCode] };
        if ((RuleProblem(await Catalog.LoadAsync(db, cancellationToken), request) ?? await OriginatorsProblemAsync(request, cancellationToken)) is { } bad)
            return Fail(bad);
        package!.Rule = ToRule(request);
        package.RuleCeasedAt = null;
        var joined = await SyncAsync(package, cancellationToken);
        if (joined > 0) ResetAssessment(package);
        await audit.WriteAsync(Actor(access), "PACKAGE_RULE", "Package", package.Id, package.Number,
            package.Rule is null ? "No rule: documents are added by hand." : $"Fills itself by its rule; {joined} document(s) joined.",
            package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, null);
    }

    // ── Asking a supplier ─────────────────────────────────────────────────────

    /// <summary>
    /// Asks the supplier of a supply package, on one transmittal, for every placeholder in it not asked for yet, each
    /// with the date it is due. The supplier fills them and sends them back on a transmittal of its own.
    /// </summary>
    public async Task<(Package? Package, IResult? Problem)> RequestAsync(
        ProjectAccess access, Guid id, SupplyRequest request, CancellationToken cancellationToken)
    {
        var (package, problem) = await ComposableAsync(access, id, cancellationToken);
        if (problem is not null) return Fail(problem);
        if (package!.Kind != PackageKinds.Supply)
            return Fail(Problems.Conflict("NOT_A_SUPPLY_PACKAGE", "Only a supply package asks a supplier for documents."));
        await SyncAsync(package, cancellationToken);
        var asking = package.Members.Where(m => m.RequestedAt is null).ToList();
        if (asking.Count == 0) return Fail(Problems.Conflict("NOTHING_TO_REQUEST", "Every document in it has been asked for already."));
        var ids = asking.Select(m => m.DocumentId).ToList();
        var documents = await db.Documents.AsNoTracking().Where(d => ids.Contains(d.Id)).OrderBy(d => d.Number).ToListAsync(cancellationToken);
        var supplier = await db.Parties.AsNoTracking().SingleAsync(p => p.Id == package.SupplierPartyId, cancellationToken);
        var members = await transmittals.MembersAsync(access.Project, cancellationToken);
        var message = string.IsNullOrWhiteSpace(request.Message) ? null : request.Message.Trim();
        var sent = await transmittals.RaiseAsync(new TransmittalService.Raise(access.Project, Actor(access), package.Reason,
            $"{package.Number}: {documents.Count} document(s) to send", message, supplier, supplier.Name, [],
            TransmittalService.AddresseesOf(supplier, members), ResponseDue: package.CompletionDate, PackageId: package.Id,
            Placeholders: documents.Select(d => (d, d.PlannedDate ?? package.CompletionDate)).ToList()), cancellationToken);
        var now = clock.GetCurrentInstant();
        foreach (var member in asking) member.RequestedAt = now;
        await audit.WriteAsync(Actor(access), "SUPPLY_REQUESTED", "Package", package.Id, package.Number,
            $"{documents.Count} document(s) asked of {supplier.Name} on {sent.Number}.", package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, null);
    }

    // ── Name, and deleting an empty one ───────────────────────────────────────

    /// <summary>Renames a package and changes its description. Its owners or Document Control do this, at any time.</summary>
    public async Task<(Package? Package, IResult? Problem)> RenameAsync(
        ProjectAccess access, Guid id, RenameRequest request, CancellationToken cancellationToken)
    {
        var package = await LoadAsync(access, id, cancellationToken);
        if (package is null) return Fail(NotFound());
        if (!access.IsInternal || (!package.OwnerIds.Contains(access.UserId) && !access.Holds(Verbs.Control)))
            return Fail(Problems.Forbidden("OWNER_ONLY", "Its owners or Document Control rename a package."));
        var title = request.Title?.Trim() ?? "";
        if (title.Length == 0) return Fail(Problems.Invalid("TITLE_REQUIRED", "Give the package a title."));
        var was = package.Title;
        package.Title = title;
        package.Description = Blank(request.Description);
        await audit.WriteAsync(Actor(access), "PACKAGE_RENAMED", "Package", package.Id, package.Number,
            was == title ? "Description changed." : $"Renamed from \"{was}\".", package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, null);
    }

    /// <summary>
    /// Deletes a package that holds no document and never went anywhere. Anything else is kept: the database refuses
    /// it too. The deletion is in the audit trail, and the number is never given out again.
    /// </summary>
    public async Task<IResult?> DeleteAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken, string? reason = null)
    {
        var (package, problem) = await ComposableAsync(access, id, cancellationToken);
        if (problem is not null) return problem;
        if (package!.Members.Count > 0)
            return Problems.Conflict("PACKAGE_NOT_EMPTY", "Take its documents out first: only an empty package is deleted.");
        if (await db.Transmittals.AnyAsync(t => t.PackageId == package.Id, cancellationToken))
            return Problems.Conflict("PACKAGE_HAS_GONE_OUT", "A transmittal went out for it; it is kept.");
        db.Packages.Remove(package);
        await audit.WriteAsync(Actor(access), "PACKAGE_DELETED", "Package", package.Id, package.Number,
            $"{package.Title}: deleted while empty.{(Blank(reason) is { } why ? $" {why}" : "")}", package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return null;
    }

    // ── Readiness ─────────────────────────────────────────────────────────────

    /// <summary>
    /// One member's readiness: its released revision and status (empty when none), the statuses it needs, and whether
    /// it is ready.
    /// </summary>
    public sealed record Readiness(PackageMember Member, string DocumentNumber, string Title, string? Revision, string? Status,
        string[] Required, bool Ready, Guid? RevisionId, string? LatestRevision = null, string? LatestState = null, LocalDate? DueDate = null);

    /// <summary>Each member against the status it needs: its released revision, if any, at one of them.</summary>
    public async Task<List<Readiness>> ReadinessAsync(Package package, CancellationToken cancellationToken)
    {
        var ids = package.Members.Select(m => m.DocumentId).ToList();
        var documents = await db.Documents.AsNoTracking().Where(d => ids.Contains(d.Id))
            .Select(d => new { d.Id, d.Number, d.Title, d.LatestRevisionValue, d.LatestRevisionState, d.PlannedDate })
            .ToDictionaryAsync(d => d.Id, cancellationToken);
        var released = await db.Revisions.AsNoTracking()
            .Where(r => ids.Contains(r.DocumentId) && r.State == RevisionStates.Released)
            .Select(r => new { r.Id, r.DocumentId, r.Value, r.StatusCode }).ToListAsync(cancellationToken);
        return package.Members.Select(m =>
        {
            var current = released.FirstOrDefault(r => r.DocumentId == m.DocumentId);
            var required = m.RequiredStatuses.Length > 0 ? m.RequiredStatuses : package.RequiredStatuses;
            var ready = current?.StatusCode is { } status && required.Contains(status);
            var d = documents[m.DocumentId];
            return new Readiness(m, d.Number, d.Title, current?.Value, current?.StatusCode, required, ready, current?.Id,
                d.LatestRevisionValue, d.LatestRevisionState, d.PlannedDate ?? package.CompletionDate);
        }).OrderBy(r => r.DocumentNumber).ToList();
    }

    /// <summary>Check every member; what is not ready is the shortfall.</summary>
    public async Task<(Package? Package, IResult? Problem)> AssessAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var (package, problem) = await ComposableAsync(access, id, cancellationToken);
        if (problem is not null) return Fail(problem);
        await SyncAsync(package!, cancellationToken);
        var readiness = await ReadinessAsync(package!, cancellationToken);
        package!.AssessedAt = clock.GetCurrentInstant();
        package.Shortfall = readiness.Where(r => !r.Ready).Select(r => new ShortfallLine
        {
            DocumentId = r.Member.DocumentId,
            DocumentNumber = r.DocumentNumber,
            Required = r.Required,
            Current = r.Status,
        }).ToList();
        package.ShortfallIssuedAt = null;
        package.ShortfallAcceptedAt = null;
        package.ShortfallAcceptedByName = null;
        await audit.WriteAsync(Actor(access), "PACKAGE_ASSESSED", "Package", package.Id, package.Number,
            package.Shortfall.Count == 0 ? $"Complete: all {readiness.Count} document(s) at the status they need."
                : $"Shortfall: {package.Shortfall.Count} of {readiness.Count} document(s) not ready.",
            package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, null);
    }

    /// <summary>
    /// Sends the shortfall found by the last assessment to the acceptance authority for their decision.
    /// </summary>
    public async Task<(Package? Package, IResult? Problem)> IssueShortfallAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var (package, problem) = await ComposableAsync(access, id, cancellationToken);
        if (problem is not null) return Fail(problem);
        if (package!.AssessedAt is null || package.Shortfall.Count == 0)
            return Fail(Problems.Conflict("NO_SHORTFALL", "Assess it first; a shortfall is what the assessment found missing."));
        package.ShortfallIssuedAt = clock.GetCurrentInstant();
        await audit.WriteAsync(Actor(access), "SHORTFALL_ISSUED", "Package", package.Id, package.Number,
            $"{package.Shortfall.Count} document(s) not ready, sent to the acceptance authority.", package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, null);
    }

    /// <summary>The acceptance authority agrees it may go without what is missing. Recorded with their name.</summary>
    public async Task<(Package? Package, IResult? Problem)> AcceptShortfallAsync(
        ProjectAccess access, Guid id, NoteRequest request, CancellationToken cancellationToken)
    {
        var package = await LoadAsync(access, id, cancellationToken);
        if (package is null) return Fail(NotFound());
        if (!package.AcceptorIds.Contains(access.UserId))
            return Fail(Problems.Forbidden("ACCEPTOR_ONLY", "Only the acceptance authority accepts a shortfall."));
        if (package.State != PackageStates.Open) return Fail(Closed(package));
        if (package.ShortfallIssuedAt is null)
            return Fail(Problems.Conflict("SHORTFALL_NOT_ISSUED", "No shortfall has been sent to you."));
        package.ShortfallAcceptedAt = clock.GetCurrentInstant();
        package.ShortfallAcceptedByName = access.UserName;
        await audit.WriteAsync(Actor(access), "SHORTFALL_ACCEPTED", "Package", package.Id, package.Number,
            $"May go without {string.Join(", ", package.Shortfall.Select(s => s.DocumentNumber))}. {request.Note}".Trim(),
            package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, null);
    }

    // ── Delivering and accepting ──────────────────────────────────────────────

    /// <summary>
    /// Deliver: one transmittal per organization, carrying every member that is
    /// ready. Not while anything is missing that the acceptance authority has not
    /// accepted, and not while a rule is still admitting. Its contents are then fixed.
    /// </summary>
    public async Task<(Package? Package, IReadOnlyList<Transmittal> Sent, IResult? Problem)> DeliverAsync(
        ProjectAccess access, Guid id, DeliverRequest request, CancellationToken cancellationToken)
    {
        var (package, problem) = await ComposableAsync(access, id, cancellationToken);
        if (problem is not null) return (null, [], problem);
        await SyncAsync(package!, cancellationToken);
        if (package!.AssessedAt is null)
            return (null, [], Problems.Conflict("NOT_ASSESSED", "Check readiness first.", new { }));
        var readiness = await ReadinessAsync(package, cancellationToken);
        var missing = readiness.Where(r => !r.Ready).ToList();
        var recorded = package.Shortfall.Select(s => s.DocumentId).ToHashSet();
        if (missing.Any(r => !recorded.Contains(r.Member.DocumentId)))
        {
            return (null, [], Problems.Conflict("SHORTFALL_CHANGED",
                "Something is missing that the last assessment did not find. Assess it again.",
                new { documents = missing.Where(r => !recorded.Contains(r.Member.DocumentId)).Select(r => r.DocumentNumber) }));
        }
        if (missing.Count > 0 && package.ShortfallAcceptedAt is null)
        {
            return (null, [], package.ShortfallIssuedAt is null
                ? Problems.Conflict("SHORTFALL_NOT_ISSUED", "Some documents are not ready. Send the shortfall to the acceptance authority first.")
                : Problems.Conflict("SHORTFALL_NOT_ACCEPTED", "Delivery waits for the acceptance authority to accept what is missing."));
        }
        if (package.Rule is not null && !request.RuleCeased)
        {
            return (null, [], Problems.Conflict("RULE_STILL_ADMITTING",
                "The package fills itself by a rule. Say that nothing more will join before it goes."));
        }
        var ready = readiness.Where(r => r.Ready).ToList();
        if (package.RecipientPartyIds.Length > 0 && ready.Count == 0)
            return (null, [], Problems.Conflict("NOTHING_READY", "Nothing is ready to deliver."));

        var now = clock.GetCurrentInstant();
        var actor = Actor(access);
        var sent = new List<Transmittal>();
        if (package.RecipientPartyIds.Length > 0)
        {
            var documentIds = ready.Select(r => r.Member.DocumentId).ToList();
            var documents = await db.Documents.Where(d => documentIds.Contains(d.Id)).ToDictionaryAsync(d => d.Id, cancellationToken);
            var revisionIds = ready.Select(r => r.RevisionId!.Value).ToList();
            var revisions = await db.Revisions.Where(r => revisionIds.Contains(r.Id)).ToDictionaryAsync(r => r.DocumentId, cancellationToken);
            var items = ready.Select(r => (documents[r.Member.DocumentId], revisions[r.Member.DocumentId])).ToList();
            var members = await transmittals.MembersAsync(access.Project, cancellationToken);
            var parties = await db.Parties.AsNoTracking().Where(p => package.RecipientPartyIds.Contains(p.Id)).OrderBy(p => p.Name)
                .ToListAsync(cancellationToken);
            foreach (var party in parties)
            {
                // Handed over inside our own organization: to whoever accepts it, not to everyone.
                var addressees = party.IsInternal
                    ? members.Where(m => package.AcceptorIds.Contains(m.UserId))
                        .Select(m => new TransmittalService.Addressee(m.UserId, null, m.Name, party.Name)).ToList()
                    : TransmittalService.AddresseesOf(party, members);
                sent.Add(await transmittals.RaiseAsync(new TransmittalService.Raise(access.Project, actor, package.Reason,
                    $"{package.Number} {package.Title}: {ready.Count} document(s)", AlsoFor(package, Blank(request.Note)), party, party.Name,
                    items, addressees, PackageId: package.Id), cancellationToken));
            }
        }

        package.State = sent.Count > 0 ? PackageStates.Delivered : PackageStates.Closed;
        package.ClosedAt = now;
        package.ClosedByName = access.UserName;
        package.ClosureNote = Blank(request.Note);
        if (package.Rule is not null) package.RuleCeasedAt = now;
        await audit.WriteAsync(actor, sent.Count > 0 ? "PACKAGE_DELIVERED" : "PACKAGE_CLOSED", "Package", package.Id, package.Number,
            sent.Count > 0 ? $"{ready.Count} of {readiness.Count} document(s) on {string.Join(", ", sent.Select(t => t.Number))}."
                : $"Closed with {ready.Count} of {readiness.Count} document(s) ready; nobody to deliver it to.",
            package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, sent, null);
    }

    /// <summary>The acceptance authority accepts a delivered or closed package. Never one of its owners.</summary>
    public async Task<(Package? Package, IResult? Problem)> AcceptAsync(
        ProjectAccess access, Guid id, NoteRequest request, CancellationToken cancellationToken)
    {
        var package = await LoadAsync(access, id, cancellationToken);
        if (package is null) return Fail(NotFound());
        if (!package.AcceptorIds.Contains(access.UserId))
            return Fail(Problems.Forbidden("ACCEPTOR_ONLY", "Only the acceptance authority accepts the package."));
        if (package.State is not (PackageStates.Delivered or PackageStates.Closed))
        {
            return Fail(Problems.Conflict(package.State == PackageStates.Accepted ? "ALREADY_ACCEPTED" : "NOT_DELIVERED",
                package.State == PackageStates.Accepted ? "It is already accepted." : "A package is accepted once it is delivered.",
                new { state = package.State }));
        }
        package.State = PackageStates.Accepted;
        package.AcceptedAt = clock.GetCurrentInstant();
        package.AcceptedByName = access.UserName;
        await audit.WriteAsync(Actor(access), "PACKAGE_ACCEPTED", "Package", package.Id, package.Number,
            $"Accepted by {access.UserName}. {request.Note}".Trim(), package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, null);
    }

    // ── Reading ───────────────────────────────────────────────────────────────

    /// <summary>
    /// The packages of the project, newest first, at most 500. Empty for people outside our organization or without the
    /// Read permission.
    /// </summary>
    public async Task<IReadOnlyList<PackageSummary>> ListAsync(ProjectAccess access, CancellationToken cancellationToken)
    {
        if (!access.Holds(Verbs.Read)) return [];
        var rows = await Visible(access)
            .OrderByDescending(p => p.CreatedAt).Take(500)
            .Select(p => new
            {
                p.Id,
                p.Number,
                p.Kind,
                Supplier = db.Parties.Where(x => x.Id == p.SupplierPartyId).Select(x => x.Name).FirstOrDefault(),
                p.PurchaseOrder,
                p.Title,
                p.Reason,
                p.State,
                Members = p.Members.Count,
                HasRule = p.Rule != null,
                p.CompletionDate,
                p.CreatedAt
            })
            .ToListAsync(cancellationToken);
        return rows.Select(p => new PackageSummary(p.Id, p.Number, p.Title, p.Reason, p.State, p.Members, p.HasRule,
            p.CompletionDate?.ToDateOnly(), p.CreatedAt.ToDateTimeOffset(), p.Kind, p.Supplier, p.PurchaseOrder)).ToList();
    }

    /// <summary>The package, brought up to date with its rule.</summary>
    public async Task<Package?> ReadAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var package = await LoadAsync(access, id, cancellationToken);
        if (package is not null && await SyncAsync(package, cancellationToken) > 0)
        {
            ResetAssessment(package);
            await db.SaveChangesAsync(cancellationToken);
        }
        return package;
    }

    /// <summary>
    /// The transmittals of a package, in the order they were raised: what delivered it, or, for a supply package, what
    /// asked its supplier and what the supplier sent back with any of its documents in it.
    /// </summary>
    public async Task<IReadOnlyList<PackageTransmittal>> TransmittalsAsync(Package package, CancellationToken cancellationToken)
    {
        var ids = package.Members.Select(m => m.DocumentId).ToList();
        var query = package.Kind == PackageKinds.Supply
            ? db.Transmittals.Where(t => t.PackageId == package.Id || (t.Direction == TransmittalDirections.Incoming
                && t.FromPartyId == package.SupplierPartyId && t.Items.Any(i => i.DocumentId != null && ids.Contains(i.DocumentId.Value))))
            : db.Transmittals.Where(t => t.PackageId == package.Id);
        return await query.AsNoTracking().OrderBy(t => t.IssuedAt)
            .Select(t => new PackageTransmittal(t.Id, t.Number, t.Direction, t.IssuedAt.ToDateTimeOffset(), t.Items.Count))
            .ToListAsync(cancellationToken);
    }

    /// <summary>The supplier's name for a supply package; null for a delivery package.</summary>
    public async Task<string?> SupplierNameAsync(Package package, CancellationToken cancellationToken) =>
        package.SupplierPartyId is { } id ? await db.Parties.Where(p => p.Id == id).Select(p => p.Name).SingleOrDefaultAsync(cancellationToken) : null;

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Every document the rule admits joins, unless taken out by hand. Nothing
    /// joins once it is delivered or the rule has stopped admitting.
    /// </summary>
    private async Task<int> SyncAsync(Package package, CancellationToken cancellationToken)
    {
        if (package.Rule is not { IsEmpty: false } rule || package.State != PackageStates.Open || package.RuleCeasedAt is not null) return 0;
        var query = db.Documents.AsNoTracking()
            .Where(d => d.ProjectId == package.ProjectId && (d.State == DocumentStates.Planned || d.State == DocumentStates.Active));
        if (rule.DeliverableTypes.Length > 0) query = query.Where(d => rule.DeliverableTypes.Contains(d.DeliverableType));
        if (rule.Disciplines.Length > 0) query = query.Where(d => rule.Disciplines.Contains(d.Discipline));
        if (rule.DocTypes.Length > 0) query = query.Where(d => rule.DocTypes.Contains(d.DocType));
        if (rule.Originators.Length > 0) query = query.Where(d => d.Originator != null && rule.Originators.Contains(d.Originator));
        if (rule.AssetIds.Length > 0)
            query = query.Where(d => db.Set<Records.DocumentAsset>().Any(l => l.DocumentId == d.Id && rule.AssetIds.Contains(l.AssetId)));
        // A supplier with several orders: each supply package holds what its own order covers.
        if (package.Kind == PackageKinds.Supply && package.PurchaseOrder is { } order) query = query.Where(d => d.ContractRef == order);
        // What a supplier owes is what was planned; something it sent unplanned (an RFI, an NCR) and we registered is not.
        if (package.Kind == PackageKinds.Supply)
            query = query.Where(d => !db.TransmittalItems.Any(i => i.DocumentId == d.Id && i.Kind == TransmittalItemKinds.Unplanned));
        var have = package.Members.Select(m => m.DocumentId).Concat(package.Excluded).ToList();
        var fresh = await query.Where(d => !have.Contains(d.Id)).Select(d => d.Id).ToListAsync(cancellationToken);
        foreach (var documentId in fresh) package.Members.Add(NewMember(package, documentId, [], byRule: true));
        return fresh.Count;
    }

    /// <summary>Builds a new member row for a document. The caller adds it to the package.</summary>
    private PackageMember NewMember(Package package, Guid documentId, string[] required, bool byRule) => new()
    {
        TenantId = package.TenantId,
        PackageId = package.Id,
        DocumentId = documentId,
        RequiredStatuses = required,
        ByRule = byRule,
        AddedAt = clock.GetCurrentInstant(),
    };

    /// <summary>A change to what is in it makes the last assessment, and anything agreed on it, stale.</summary>
    private static void ResetAssessment(Package package)
    {
        package.AssessedAt = null;
        package.Shortfall = [];
        package.ShortfallIssuedAt = null;
        package.ShortfallAcceptedAt = null;
        package.ShortfallAcceptedByName = null;
    }

    /// <summary>
    /// Loads a package the caller may change: they must be an owner or hold Control, and it must still be open.
    /// Otherwise returns the problem to answer with.
    /// </summary>
    private async Task<(Package?, IResult?)> ComposableAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var package = await LoadAsync(access, id, cancellationToken);
        if (package is null) return (null, NotFound());
        if (!access.IsInternal || (!package.OwnerIds.Contains(access.UserId) && !access.Holds(Verbs.Control)))
            return (null, Problems.Forbidden("OWNER_ONLY", "Its owners or Document Control change and deliver a package."));
        if (package.State != PackageStates.Open) return (null, Closed(package));
        return (package, null);
    }

    /// <summary>
    /// Loads a package with its members, or null when it does not exist or the caller is outside our organization or
    /// lacks the Read permission.
    /// </summary>
    private Task<Package?> LoadAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken) =>
        !access.Holds(Verbs.Read)
            ? Task.FromResult<Package?>(null)
            : Visible(access).Include(p => p.Members).SingleOrDefaultAsync(p => p.Id == id, cancellationToken);

    /// <summary>
    /// The project's packages this person may see: all of them for our own people; for another organization's people,
    /// only the supply packages of what that organization owes.
    /// </summary>
    private IQueryable<Package> Visible(ProjectAccess access)
    {
        var query = db.Packages.Where(p => p.ProjectId == access.Project.Id);
        if (access.IsInternal) return query;
        var code = access.PartyCode;
        return query.Where(p => p.Kind == PackageKinds.Supply && db.Parties.Any(x => x.Id == p.SupplierPartyId && x.Code == code));
    }

    /// <summary>The supplier's code for a supply package; null for a delivery package.</summary>
    private async Task<string?> SupplierCodeAsync(Package package, CancellationToken cancellationToken) =>
        package.Kind != PackageKinds.Supply ? null
            : await db.Parties.Where(p => p.Id == package.SupplierPartyId).Select(p => p.Code).SingleAsync(cancellationToken);

    /// <summary>
    /// Checks that every status given is a published status. Returns the problem, or null when fine. With
    /// <c>required</c> true an empty list is also a problem.
    /// </summary>
    private static IResult? StatusesProblem(Catalog catalog, string[]? statuses, bool required)
    {
        if (statuses is null || statuses.Length == 0)
        {
            return required ? Problems.Invalid("STATUS_REQUIRED", "Say the status each document needs to reach: IFC, AFC…") : null;
        }
        var unknown = statuses.Where(s => !catalog.IsActive(Reviews.ReviewSets.Statuses, s)).ToList();
        return unknown.Count == 0 ? null
            : Problems.Invalid("VALUE_NOT_PUBLISHED", $"{string.Join(", ", unknown)} is not a published status.",
                new { field = "requiredStatuses", value = unknown });
    }

    /// <summary>
    /// Checks the rule's deliverable types, disciplines and document types are published values. Returns the problem,
    /// or null when fine. Originators are checked by <see cref="OriginatorsProblemAsync"/>.
    /// </summary>
    /// <summary>Checks the rule's originators are active parties, as a document's originator must be. Returns the problem, or null when fine.</summary>
    private async Task<IResult?> OriginatorsProblemAsync(RuleRequest? rule, CancellationToken cancellationToken)
    {
        var named = rule?.Originators?.Distinct().ToList() ?? [];
        if (named.Count == 0) return null;
        var known = await db.Parties.Where(p => named.Contains(p.Code) && p.Active).Select(p => p.Code).ToListAsync(cancellationToken);
        var unknown = named.Except(known).ToList();
        return unknown.Count == 0 ? null
            : Problems.Invalid("VALUE_NOT_PUBLISHED", $"{string.Join(", ", unknown)} is not an active party.", new { field = "rule.originators", value = unknown });
    }

    private static IResult? RuleProblem(Catalog catalog, RuleRequest? rule)
    {
        if (rule is null) return null;
        var unknown = (rule.DeliverableTypes ?? []).Where(c => !catalog.IsActive(ValueSets.DeliverableTypes, c))
            .Concat((rule.Disciplines ?? []).Where(c => !catalog.IsActive(ValueSets.Disciplines, c)))
            .Concat((rule.DocTypes ?? []).Where(c => !catalog.IsActive(ValueSets.DocumentTypes, c))).ToList();
        return unknown.Count == 0 ? null
            : Problems.Invalid("VALUE_NOT_PUBLISHED", $"{string.Join(", ", unknown)} is not a published value.", new { field = "rule", value = unknown });
    }

    /// <summary>
    /// Turns the request rule into the stored rule, removing duplicates. Returns null when nothing is filled in.
    /// </summary>
    private static PackageRule? ToRule(RuleRequest? request)
    {
        if (request is null) return null;
        var rule = new PackageRule
        {
            DeliverableTypes = request.DeliverableTypes?.Distinct().ToArray() ?? [],
            Disciplines = request.Disciplines?.Distinct().ToArray() ?? [],
            DocTypes = request.DocTypes?.Distinct().ToArray() ?? [],
            Originators = request.Originators?.Distinct().ToArray() ?? [],
            AssetIds = request.AssetIds?.Distinct().ToArray() ?? [],
        };
        return rule.IsEmpty ? null : rule;
    }

    /// <summary>The note on a package's transmittal, naming the further reasons it goes for.</summary>
    private static string? AlsoFor(Package package, string? note) => package.OtherReasons.Length == 0 ? note
        : $"Also for: {string.Join(", ", package.OtherReasons)}.{(note is null ? "" : $" {note}")}";

    /// <summary>Trims text and turns empty or whitespace-only text into null.</summary>
    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    /// <summary>The calling user as the audit log records them.</summary>
    private static Actor Actor(ProjectAccess access) => new(access.UserId, access.UserName);
    /// <summary>The 404 answer for a package that does not exist or is not visible.</summary>
    private static IResult NotFound() => Problems.NotFound("PACKAGE_NOT_FOUND", "No such package.");
    /// <summary>The 409 answer when a package has already been delivered, closed or accepted.</summary>
    private static IResult Closed(Package package) => Problems.Conflict("PACKAGE_CLOSED",
        "The package has gone; what it held is kept as it was.", new { state = package.State });
    /// <summary>Shortcut for returning a problem with no package.</summary>
    private static (Package?, IResult?) Fail(IResult problem) => (null, problem);
}
