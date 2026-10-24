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
    Dictionary<string, string?>? Extras = null, Guid? ParentId = null);

/// <summary>Body of moving a package: the package it goes inside (none: to the top), and why, optionally.</summary>
public sealed record MoveRequest(Guid? ParentId, string? Reason = null);

/// <summary>
/// Body of changing a package. Title and description always; the rest, left out, stay as they are (a delivery package
/// only): the date, the statuses it needs, who it goes to, who puts it together and who accepts it.
/// </summary>
public sealed record RenameRequest(string? Title, string? Description = null, string? Number = null,
    DateOnly? CompletionDate = null, bool ClearCompletionDate = false, string[]? RequiredStatuses = null,
    Guid[]? RecipientPartyIds = null, Guid[]? OwnerIds = null, Guid[]? AcceptorIds = null);

/// <summary>Body of asking a supplier for the placeholders of a supply package not asked for yet.</summary>
public sealed record SupplyRequest(string? Message = null, Guid[]? DocumentIds = null);

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
    DeliosDbContext db, Numbering numbering, TransmittalService transmittals, AuditLog audit, IClock clock, SupplyFiling filing,
    Notifications.Notifier notifier)
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
        // What the project's package form insists on (Settings, Forms & fields). A supplier's package has no due day of
        // its own (each document is due on its planned date), so it is never asked one.
        if (await Settings.FormRules.CheckAsync(db, access.Project.Id, "PACKAGE", new Dictionary<string, bool>
            {
                ["description"] = !string.IsNullOrWhiteSpace(request.Description),
                ["completionDate"] = request.CompletionDate is not null || request.Kind == PackageKinds.Supply,
                ["po"] = !string.IsNullOrWhiteSpace(request.PurchaseOrder),
            }, request.Extras, cancellationToken) is { } formProblem) return Fail(formProblem);

        var catalog = await Catalog.LoadAsync(db, cancellationToken);
        var kind = request.Kind ?? PackageKinds.Delivery;
        if (kind is not (PackageKinds.Delivery or PackageKinds.Supply))
            return Fail(Problems.Invalid("KIND_UNKNOWN", "A package is a delivery or a supply.", new { kind }));
        var supply = kind == PackageKinds.Supply;
        // What a supplier owes needs no status: each document goes as it is asked. A delivery says what it needs.
        if (StatusesProblem(catalog, request.RequiredStatuses, required: !supply) is { } badStatus) return Fail(badStatus);
        var statuses = request.RequiredStatuses?.Distinct().ToArray() ?? [];
        // One reason or several: the first leads its transmittals, the others are named on them. None given: the
        // statuses it needs say why they get it.
        var given = (request.Reasons is { Length: > 0 } many ? many : [request.Reason ?? ""]).Select(r => r.Trim()).Where(r => r.Length > 0).Distinct().ToArray();
        var reasons = given.Length > 0 ? given : ReasonFor(catalog, statuses) is { } derived ? [derived] : [];
        if (reasons.Length == 0)
            return Fail(Problems.Invalid("REASON_REQUIRED", "No published reason for issue matches the status it needs: publish one, or name the reason."));
        var reason = reasons[0];
        if (reasons.FirstOrDefault(r => !catalog.IsActive(TransmittalSets.Reasons, r)) is { } badReason)
        {
            return Fail(Problems.Invalid("VALUE_NOT_PUBLISHED", $"{badReason} is not a published reason for issue.",
                new { field = "reason", value = badReason }));
        }

        var owners = request.OwnerIds?.Distinct().ToArray() ?? [];
        var acceptors = request.AcceptorIds?.Distinct().ToArray() ?? [];
        // A supplier's package is the control function's: nobody accepts it, it is never delivered.
        if (supply && owners.Length == 0) owners = [access.UserId];
        if (owners.Length == 0 || (!supply && acceptors.Length == 0))
            return Fail(Problems.Invalid("ROLES_REQUIRED", "Name who puts it together and who accepts it."));
        // Nobody accepts their own work.
        if (owners.Intersect(acceptors).Any())
            return Fail(Problems.Invalid("ACCEPTOR_IS_OWNER", "Whoever accepts a package is never one of the people who put it together."));
        var members = (await transmittals.MembersAsync(access.Project, cancellationToken)).Where(m => m.Internal)
            .Select(m => m.UserId).ToHashSet();
        var strangers = owners.Concat(acceptors).Where(id => !members.Contains(id)).ToList();
        if (strangers.Count > 0)
            return Fail(Problems.Invalid("PERSON_NOT_ON_PROJECT", "Some people named are not ours on this project.", new { userIds = strangers }));

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
        // Inside another package (a branch of the arborescence): the same kind, the same supplier, still open.
        Package? parent = null;
        if (request.ParentId is { } parentId)
        {
            parent = await Visible(access).SingleOrDefaultAsync(p => p.Id == parentId, cancellationToken);
            if (ParentProblem(parent, kind, supplier?.Id) is { } badParent) return Fail(badParent);
        }

        var now = clock.GetCurrentInstant();
        var package = new Package
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            Number = await numbering.RecordAsync(access.Project.TenantId, access.Project.Id, RecordKinds.Package,
                NumberFields.ForRecord(access.Project.Code), "PK", cancellationToken),
            Kind = kind,
            ParentId = parent?.Id,
            SupplierPartyId = supplier?.Id,
            PurchaseOrder = Blank(request.PurchaseOrder),
            Title = title,
            Description = Blank(request.Description),
            Reason = reason,
            OtherReasons = reasons[1..],
            Extras = Documents.OwnFields.Write(null, request.Extras),
            RequiredStatuses = statuses,
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
            (package.Rule is null ? $"{title}: documents added by hand." : $"{title}: fills itself by its rule; {joined} document(s) now.")
            + (parent is null ? "" : $" Inside {parent.Number}."),
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
        var (package, problem) = await ComposableAsync(access, id, cancellationToken, members: true);
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
        // One package per document (the arborescence, owner): within a tree of delivery packages, and among a supplier's
        // packages. Added here, it leaves the other, which no longer takes it back; one already delivered, or sent to the
        // supplier, stays where it went.
        var movedFrom = new List<string>();
        var others = await SharingAsync(package, cancellationToken);
        if (others.Count > 0)
        {
            var elsewhere = await db.PackageMembers.Where(m => fresh.Contains(m.DocumentId) && others.Contains(m.PackageId)).ToListAsync(cancellationToken);
            var fixedIn = await db.Packages.AsNoTracking()
                .Where(p => elsewhere.Select(m => m.PackageId).Contains(p.Id) && p.State != PackageStates.Open).Select(p => p.Number).ToListAsync(cancellationToken);
            if (fixedIn.Count > 0)
                return Fail(Problems.Conflict("ALREADY_DELIVERED", $"Some of them went out with {string.Join(", ", fixedIn)}, which is delivered: they stay there.",
                    new { packages = fixedIn }));
            var sentIds = elsewhere.Where(m => m.RequestedAt is not null).Select(m => m.DocumentId).ToList();
            if (sentIds.Count > 0)
            {
                var sentNumbers = await db.Documents.AsNoTracking().Where(d => sentIds.Contains(d.Id)).Select(d => d.Number).ToListAsync(cancellationToken);
                return Fail(Problems.Conflict("SENT_TO_SUPPLIER",
                    $"{string.Join(", ", sentNumbers)} {(sentNumbers.Count == 1 ? "was" : "were")} sent to the supplier from another of its packages and stay{(sentNumbers.Count == 1 ? "s" : "")} there.",
                    new { documents = sentNumbers }));
            }
            foreach (var group in elsewhere.GroupBy(m => m.PackageId))
            {
                var other = await db.Packages.SingleAsync(p => p.Id == group.Key, cancellationToken);
                other.Excluded = other.Excluded.Union(group.Select(m => m.DocumentId)).ToArray();
                ResetAssessment(other);
                movedFrom.Add(other.Number);
                db.PackageMembers.RemoveRange(group);
            }
        }
        foreach (var documentId in fresh)
        {
            package.Members.Add(NewMember(package, documentId, request.RequiredStatuses?.Distinct().ToArray() ?? [], byRule: false));
        }
        // Put back by hand: the rule's exclusion no longer applies.
        package.Excluded = package.Excluded.Except(fresh).ToArray();
        ResetAssessment(package);
        await audit.WriteAsync(Actor(access), "PACKAGE_MEMBERS_ADDED", "Package", package.Id, package.Number,
            $"{fresh.Count} document(s) added{(movedFrom.Count > 0 ? $", taken out of {string.Join(", ", movedFrom)}" : "")}.", package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, null);
    }

    /// <summary>Take documents out. One the rule matches stays out.</summary>
    public async Task<(Package? Package, IResult? Problem)> RemoveAsync(
        ProjectAccess access, Guid id, MembersRequest request, CancellationToken cancellationToken)
    {
        var (package, problem) = await ComposableAsync(access, id, cancellationToken, members: true);
        if (problem is not null) return Fail(problem);
        var ids = request.DocumentIds?.ToHashSet() ?? [];
        var going = package!.Members.Where(m => ids.Contains(m.DocumentId)).ToList();
        if (going.Count == 0) return Fail(Problems.Invalid("DOCUMENTS_REQUIRED", "Say which documents to take out."));
        // A document already sent to its supplier on a transmittal stays in its package: that is where it was asked.
        var sentIds = going.Where(m => m.RequestedAt is not null).Select(m => m.DocumentId).ToList();
        var sent = sentIds.Count == 0 ? [] : await db.Documents.AsNoTracking().Where(d => sentIds.Contains(d.Id)).Select(d => d.Number).ToListAsync(cancellationToken);
        if (sent.Count > 0)
            return Fail(Problems.Conflict("SENT_TO_SUPPLIER",
                $"{string.Join(", ", sent)} {(sent.Count == 1 ? "was" : "were")} sent to the supplier on a transmittal and stay{(sent.Count == 1 ? "s" : "")} in the package.",
                new { documents = sent }));
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
        if (package!.Kind == PackageKinds.Supply && package.SharedAt is not null)
            return Fail(Problems.Conflict("PACKAGE_SHARED", "It is shared with its supplier: its rule no longer changes."));
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
        if (package.SharedAt is null)
            return Fail(Problems.Conflict("NOT_SHARED", "Share the package with its supplier first: they see what is asked of them there."));
        await SyncAsync(package, cancellationToken);
        // The documents ticked, never asked before: a placeholder is asked once; after, it is handed back and forth.
        var chosen = request.DocumentIds?.ToHashSet();
        var asking = package.Members.Where(m => m.RequestedAt is null && (chosen is null || chosen.Contains(m.DocumentId))).ToList();
        if (asking.Count == 0) return Fail(Problems.Conflict("NOTHING_TO_REQUEST", "Tick documents not asked for yet."));
        if (chosen is not null && package.Members.Any(m => chosen.Contains(m.DocumentId) && m.RequestedAt is not null))
            return Fail(Problems.Conflict("ALREADY_REQUESTED", "Some ticked documents were asked for already: to change one, ask for it back from its page."));
        var ids = asking.Select(m => m.DocumentId).ToList();
        var documents = await db.Documents.AsNoTracking().Where(d => ids.Contains(d.Id)).OrderBy(d => d.Number).ToListAsync(cancellationToken);
        var supplier = await db.Parties.AsNoTracking().SingleAsync(p => p.Id == package.SupplierPartyId, cancellationToken);
        var members = await transmittals.MembersAsync(access.Project, cancellationToken);
        var message = string.IsNullOrWhiteSpace(request.Message) ? null : request.Message.Trim();
        var placeholderReason = (await Catalog.LoadAsync(db, cancellationToken)).IsActive(TransmittalSets.Reasons, TransmittalService.PlaceholderReason)
            ? TransmittalService.PlaceholderReason : package.Reason;
        var sent = await transmittals.RaiseAsync(new TransmittalService.Raise(access.Project, Actor(access), placeholderReason,
            $"{package.Number} — {documents.Count} document{(documents.Count == 1 ? "" : "s")} submitted to {supplier.Name}", message, supplier, supplier.Name, [],
            TransmittalService.AddresseesOf(supplier, members), ResponseDue: package.CompletionDate, PackageId: package.Id,
            Placeholders: documents.Select(d => (d, d.PlannedDate ?? package.CompletionDate)).ToList()), cancellationToken);
        var now = clock.GetCurrentInstant();
        foreach (var member in asking) member.RequestedAt = now;
        await audit.WriteAsync(Actor(access), "SUPPLY_REQUESTED", "Package", package.Id, package.Number,
            $"{documents.Count} document(s) asked of {supplier.Name} on {sent.Number}.", package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, null);
    }

    /// <summary>
    /// The control function shares a supplier's package with that supplier, once and for good: from then on its people see
    /// it, with the documents asked of them on a transmittal and nothing else. Its people are told.
    /// </summary>
    public async Task<(Package? Package, IResult? Problem)> ShareAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var (package, problem) = await ComposableAsync(access, id, cancellationToken);
        if (problem is not null) return Fail(problem);
        if (package!.Kind != PackageKinds.Supply)
            return Fail(Problems.Conflict("NOT_A_SUPPLY_PACKAGE", "Only a supplier's package is shared with its supplier."));
        if (package.SharedAt is not null) return (package, null);
        package.SharedAt = clock.GetCurrentInstant();
        package.SharedByName = access.UserName;
        var supplier = await db.Parties.AsNoTracking().SingleAsync(p => p.Id == package.SupplierPartyId, cancellationToken);
        await audit.WriteAsync(Actor(access), "PACKAGE_SHARED", "Package", package.Id, package.Number,
            $"Shared with {supplier.Name}, for good.", package.ProjectId, cancellationToken);
        var people = (await SupplierPeopleAsync(package, cancellationToken)).Select(p => p.Id).ToList();
        if (people.Count > 0)
            await notifier.NotifyAsync(access.Project.TenantId, package.ProjectId, people, Notifications.NotificationKinds.General,
                $"{package.Number} is shared with you",
                "What is asked of you appears here once it is sent to you on a transmittal.", $"/packages/{package.Number}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, null);
    }

    /// <summary>How the project takes other organizations' documents (<see cref="Intake"/>).</summary>
    public Task<IntakeView> IntakeAsync(Guid projectId, CancellationToken cancellationToken) => Intake.ReadAsync(db, projectId, cancellationToken);

    // ── Name, and deleting an empty one ───────────────────────────────────────

    /// <summary>
    /// Changes a package while it is open: its name and description, and for a delivery package its date, the statuses
    /// it needs, who it goes to, who puts it together and who accepts it. The control function (and above) does this; those
    /// putting it together only add and take out its documents. A change to what it needs or who accepts it makes the
    /// last readiness check, and anything agreed on it, stale.
    /// </summary>
    public async Task<(Package? Package, IResult? Problem)> RenameAsync(
        ProjectAccess access, Guid id, RenameRequest request, CancellationToken cancellationToken)
    {
        var (package, problem) = await ComposableAsync(access, id, cancellationToken);
        if (problem is not null) return Fail(problem);
        // What its supplier sees stays as it saw it: once shared, a supplier's package keeps its name and number.
        if (package!.Kind == PackageKinds.Supply && package.SharedAt is not null)
            return Fail(Problems.Conflict("PACKAGE_SHARED", "It is shared with its supplier: its name, number and description no longer change."));
        var title = request.Title?.Trim() ?? "";
        if (title.Length == 0) return Fail(Problems.Invalid("TITLE_REQUIRED", "Give the package a title."));
        // A package's number comes from its numbering scheme and never changes once made.
        if (request.Number?.Trim() is { Length: > 0 } asked && !string.Equals(asked, package.Number, StringComparison.OrdinalIgnoreCase))
            return Fail(Problems.Conflict("NUMBER_FIXED", "A package's number comes from its numbering scheme and never changes."));

        var changed = new List<string>();
        var stale = false;
        if (package.Title != title) changed.Add($"renamed from \"{package.Title}\"");
        if (package.Description != Blank(request.Description)) changed.Add("description");
        package.Title = title;
        package.Description = Blank(request.Description);
        if (package.Kind == PackageKinds.Delivery)
        {
            var catalog = await Catalog.LoadAsync(db, cancellationToken);
            if (request.ClearCompletionDate || request.CompletionDate is not null)
            {
                var date = request.ClearCompletionDate ? (LocalDate?)null : LocalDate.FromDateOnly(request.CompletionDate!.Value);
                if (date != package.CompletionDate) changed.Add($"date {(date is null ? "cleared" : date.Value.ToString("yyyy-MM-dd", null))}");
                package.CompletionDate = date;
            }
            if (request.RequiredStatuses is { } statuses)
            {
                if (StatusesProblem(catalog, statuses, required: true) is { } bad) return Fail(bad);
                var now = statuses.Distinct().ToArray();
                if (!now.SequenceEqual(package.RequiredStatuses))
                {
                    changed.Add($"needed at {string.Join(" or ", now)}");
                    package.RequiredStatuses = now;
                    // Why they get it follows what it needs.
                    if (ReasonFor(catalog, now) is { } reason) package.Reason = reason;
                    stale = true;
                }
            }
            var owners = request.OwnerIds?.Distinct().ToArray() ?? package.OwnerIds;
            var acceptors = request.AcceptorIds?.Distinct().ToArray() ?? package.AcceptorIds;
            if (owners.Length == 0 || acceptors.Length == 0)
                return Fail(Problems.Invalid("ROLES_REQUIRED", "Name who puts it together and who accepts it."));
            if (owners.Intersect(acceptors).Any())
                return Fail(Problems.Invalid("ACCEPTOR_IS_OWNER", "Whoever accepts a package is never one of the people who put it together."));
            var members = (await transmittals.MembersAsync(access.Project, cancellationToken)).Where(m => m.Internal).Select(m => m.UserId).ToHashSet();
            var strangers = owners.Concat(acceptors).Where(one => !members.Contains(one)).Except(package.OwnerIds.Concat(package.AcceptorIds)).ToList();
            if (strangers.Count > 0)
                return Fail(Problems.Invalid("PERSON_NOT_ON_PROJECT", "Some people named are not ours on this project.", new { userIds = strangers }));
            if (!owners.ToHashSet().SetEquals(package.OwnerIds)) changed.Add("who puts it together");
            if (!acceptors.ToHashSet().SetEquals(package.AcceptorIds))
            {
                changed.Add("who accepts it");
                stale = true;
            }
            package.OwnerIds = owners;
            package.AcceptorIds = acceptors;
            if (request.RecipientPartyIds is { } recipients)
            {
                var to = recipients.Distinct().ToArray();
                if (to.Length == 0) return Fail(Problems.Invalid("RECIPIENT_REQUIRED", "Say who it is delivered to."));
                var known = await db.Parties.AsNoTracking().Where(p => to.Contains(p.Id) && p.Active).CountAsync(cancellationToken);
                if (known != to.Length) return Fail(Problems.Invalid("PARTY_UNKNOWN", "Some organizations named are not active parties."));
                if (!to.ToHashSet().SetEquals(package.RecipientPartyIds)) changed.Add("who it goes to");
                package.RecipientPartyIds = to;
            }
        }
        if (changed.Count == 0) return (package, null);
        if (stale) ResetAssessment(package);
        await audit.WriteAsync(Actor(access), "PACKAGE_CHANGED", "Package", package.Id, package.Number,
            $"Changed: {string.Join("; ", changed)}.", package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, null);
    }

    /// <summary>
    /// Deletes a package that holds no document and never went anywhere. Anything else is kept: the database refuses
    /// it too. The deletion is in the audit trail, and the number is never given out again.
    /// </summary>
    public async Task<IResult?> DeleteAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken, string? reason = null)
    {
        // An empty package that never went out may be deleted by whoever puts it together (CLAUDE.md).
        var (package, problem) = await ComposableAsync(access, id, cancellationToken, members: true);
        if (problem is not null) return problem;
        // A supplier's package, made by hand or by itself, is deleted while it is not shared and none of its documents
        // was sent to the supplier: its documents leave it (they stay in the register) and are filed again, into
        // another package of that supplier when there is one.
        var supply = package!.Kind == PackageKinds.Supply;
        if (await db.Packages.AnyAsync(p => p.ParentId == package.Id, cancellationToken))
            return Problems.Conflict("HAS_BRANCHES", "Packages sit inside it: move them out first; it is deleted once it holds no package.");
        if (supply && package.Members.Any(m => m.RequestedAt is not null))
            return Problems.Conflict("SENT_TO_SUPPLIER", "Some of its documents were sent to the supplier on a transmittal; it is kept.");
        if (!supply && package.Members.Count > 0)
            return Problems.Conflict("PACKAGE_NOT_EMPTY", "Take its documents out first: only an empty package is deleted.");
        if (await db.Transmittals.AnyAsync(t => t.PackageId == package.Id, cancellationToken))
            return Problems.Conflict("PACKAGE_HAS_GONE_OUT", "A transmittal went out for it; it is kept.");
        if (package.SharedAt is not null)
            return Problems.Conflict("PACKAGE_SHARED", "It was shared with its supplier; it is kept.");
        var held = package.Members.Count;
        // A supplier's branch hands its documents back to the package it sits in, which takes them again.
        Package? up = null;
        if (supply && held > 0 && package.ParentId is { } parentId)
        {
            up = await db.Packages.Include(p => p.Members).SingleOrDefaultAsync(p => p.Id == parentId, cancellationToken);
            if (up is not null)
            {
                var back = package.Members.Select(m => m.DocumentId).Where(d => up.Members.All(m => m.DocumentId != d)).ToList();
                up.Excluded = up.Excluded.Except(back).ToArray();
                foreach (var documentId in back) up.Members.Add(NewMember(up, documentId, [], byRule: false));
                ResetAssessment(up);
            }
        }
        if (held > 0)
        {
            db.PackageMembers.RemoveRange(package.Members);
            await db.SaveChangesAsync(cancellationToken);
        }
        db.Packages.Remove(package);
        await audit.WriteAsync(Actor(access), "PACKAGE_DELETED", "Package", package.Id, package.Number,
            $"{package.Title}: deleted before it was shared{(held > 0 ? up is not null ? $"; its {held} document(s) go back to {up.Number}" : $"; its {held} document(s) stay in the register" : ", empty")}.{(Blank(reason) is { } why ? $" {why}" : "")}",
            package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        if (held > 0) await filing.FileUnfiledAsync(access.Project, Actor(access), cancellationToken);
        return null;
    }

    // ── The arborescence ──────────────────────────────────────────────────────

    /// <summary>
    /// Why a package cannot sit inside <paramref name="parent"/>, or null: it exists and is seen, it is of the same kind,
    /// a supplier's of the same supplier (its people see the tree), and it is still open (what was delivered is fixed).
    /// </summary>
    private static IResult? ParentProblem(Package? parent, string kind, Guid? supplierId)
    {
        if (parent is null) return Problems.NotFound("PARENT_NOT_FOUND", "There is no such package to put it in.");
        if (parent.Kind != kind)
            return Problems.Invalid("PARENT_OTHER_KIND", "A delivery package sits only in a delivery package, a supplier's only in a supplier's.");
        if (kind == PackageKinds.Supply && parent.SupplierPartyId != supplierId)
            return Problems.Invalid("PARENT_OTHER_SUPPLIER", "A supplier's package sits only in a package of the same supplier: its people see the tree.");
        if (parent.State != PackageStates.Open)
            return Problems.Conflict("PARENT_CLOSED", $"{parent.Number} is delivered: what it holds is fixed.");
        return null;
    }

    /// <summary>
    /// Moves a package inside another one, or to the top, while it is open (owner: "its own number, place shown"; the number
    /// never changes). The control function (and above) does it; a supplier's package once shared stays where its
    /// supplier saw it. Never inside itself or one of its own branches. Recorded with where it was and where it goes.
    /// </summary>
    public async Task<(Package? Package, IResult? Problem)> MoveAsync(ProjectAccess access, Guid id, MoveRequest request, CancellationToken cancellationToken)
    {
        var (package, problem) = await ComposableAsync(access, id, cancellationToken);
        if (problem is not null) return Fail(problem);
        if (package!.Kind == PackageKinds.Supply && package.SharedAt is not null)
            return Fail(Problems.Conflict("PACKAGE_SHARED", "It is shared with its supplier: it stays where they saw it."));
        if (package.ParentId == request.ParentId) return (package, null);
        Package? parent = null;
        if (request.ParentId is { } parentId)
        {
            if (parentId == package.Id) return Fail(Problems.Invalid("INSIDE_ITSELF", "A package does not go inside itself."));
            parent = await Visible(access).SingleOrDefaultAsync(p => p.Id == parentId, cancellationToken);
            if (ParentProblem(parent, package.Kind, package.SupplierPartyId) is { } bad) return Fail(bad);
            var parents = await db.Packages.AsNoTracking().Where(p => p.ProjectId == package.ProjectId)
                .Select(p => new { p.Id, p.ParentId }).ToDictionaryAsync(p => p.Id, p => p.ParentId, cancellationToken);
            // Climbing from the new place: meeting the package itself means it would sit inside its own branch.
            for (Guid? at = parentId; at is { } step; at = parents.GetValueOrDefault(step))
                if (step == package.Id) return Fail(Problems.Invalid("INSIDE_ITS_BRANCH", "A package does not go inside one of its own branches."));
            // One package per document in a tree: what it brings must not already sit in the tree it joins.
            if (package.Kind == PackageKinds.Delivery)
            {
                var children = parents.Where(p => p.Value is not null).GroupBy(p => p.Value!.Value).ToDictionary(g => g.Key, g => g.Select(p => p.Key).ToList());
                var moving = new HashSet<Guid> { package.Id };
                var queue = new Queue<Guid>([package.Id]);
                while (queue.TryDequeue(out var at))
                    foreach (var child in children.GetValueOrDefault(at) ?? [])
                        if (moving.Add(child)) queue.Enqueue(child);
                var joining = (await SharingAsync(parent!, cancellationToken)).Append(parent!.Id).Where(id => !moving.Contains(id)).ToList();
                var both = await db.PackageMembers.AsNoTracking().Where(m => moving.Contains(m.PackageId)
                        && db.PackageMembers.Any(o => o.DocumentId == m.DocumentId && joining.Contains(o.PackageId)))
                    .Join(db.Documents, m => m.DocumentId, d => d.Id, (m, d) => d.Number).Distinct().ToListAsync(cancellationToken);
                if (both.Count > 0)
                    return Fail(Problems.Conflict("IN_BOTH", $"{string.Join(", ", both)} already sit{(both.Count == 1 ? "s" : "")} in that tree: a document sits in one package of a tree; take it out of one first.",
                        new { documents = both }));
            }
        }
        var from = package.ParentId is { } was
            ? await db.Packages.AsNoTracking().Where(p => p.Id == was).Select(p => p.Number).SingleOrDefaultAsync(cancellationToken) : null;
        package.ParentId = parent?.Id;
        await audit.WriteAsync(Actor(access), "PACKAGE_MOVED", "Package", package.Id, package.Number,
            $"Where it sits: {from ?? "at the top"} → {parent?.Number ?? "at the top"}.{(Blank(request.Reason) is { } why ? $" {why}" : "")}",
            package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, null);
    }

    /// <summary>
    /// Where a package sits and what it holds below (owner: "both point to the same package page"): the packages above it,
    /// top first; its branches, each with its own count and everything under it; and the whole, this package and every
    /// package under it. Counts add up; each package still delivers alone. Only what the reader sees is counted: another
    /// organization reads only the packages shared with it, and in them only what was asked of it.
    /// </summary>
    public async Task<PackagePlace> PlaceAsync(ProjectAccess access, Package package, CancellationToken cancellationToken)
    {
        var all = await Visible(access).AsNoTracking().Where(p => p.Kind == package.Kind)
            .Select(p => new { p.Id, p.ParentId, p.Number, p.Title, p.State, p.RequiredStatuses })
            .ToDictionaryAsync(p => p.Id, cancellationToken);
        var children = all.Values.Where(p => p.ParentId is not null && all.ContainsKey(p.ParentId.Value))
            .GroupBy(p => p.ParentId!.Value).ToDictionary(g => g.Key, g => g.OrderBy(p => p.Number).Select(p => p.Id).ToList());
        List<Guid> Under(Guid id)
        {
            var found = new List<Guid>();
            var seen = new HashSet<Guid> { id };
            var queue = new Queue<Guid>([id]);
            while (queue.TryDequeue(out var at))
                foreach (var child in children.GetValueOrDefault(at) ?? [])
                    if (seen.Add(child)) { found.Add(child); queue.Enqueue(child); }
            return found;
        }
        var below = Under(package.Id);
        var counted = below.Append(package.Id).ToList();
        var members = await db.PackageMembers.AsNoTracking().Where(m => counted.Contains(m.PackageId))
            .Where(m => access.IsInternal || m.RequestedAt != null)
            .Select(m => new { m.PackageId, m.DocumentId, m.RequiredStatuses }).ToListAsync(cancellationToken);
        var documentIds = members.Select(m => m.DocumentId).Distinct().ToList();
        var released = (await db.Revisions.AsNoTracking().Where(r => documentIds.Contains(r.DocumentId) && r.State == RevisionStates.Released)
            .Select(r => new { r.DocumentId, r.StatusCode }).ToListAsync(cancellationToken))
            .GroupBy(r => r.DocumentId).ToDictionary(g => g.Key, g => g.First().StatusCode);
        // A package and everything under it: how many packages below (and still open), its documents once each, how many
        // are released at the status their package needs, and how many are released at all.
        PackageTally Tally(Guid root, IReadOnlyCollection<Guid> under)
        {
            var ids = under.Append(root).ToHashSet();
            var lines = members.Where(m => ids.Contains(m.PackageId)).ToList();
            bool Ready(Guid packageId, Guid documentId, string[] own) =>
                released.TryGetValue(documentId, out var status) && status is not null
                && (own.Length > 0 ? own : all.TryGetValue(packageId, out var p) ? p.RequiredStatuses : []).Contains(status);
            return new PackageTally(
                Packages: under.Count,
                Open: under.Count(i => all.TryGetValue(i, out var p) && p.State == PackageStates.Open),
                Documents: lines.Select(m => m.DocumentId).Distinct().Count(),
                Ready: lines.Where(m => Ready(m.PackageId, m.DocumentId, m.RequiredStatuses)).Select(m => m.DocumentId).Distinct().Count(),
                Released: lines.Where(m => released.ContainsKey(m.DocumentId)).Select(m => m.DocumentId).Distinct().Count());
        }
        // The packages above, top first, as far as the reader sees.
        var path = new List<PackageLink>();
        var guard = new HashSet<Guid>();
        for (var at = package.ParentId; at is { } step && all.TryGetValue(step, out var up) && guard.Add(step); at = up.ParentId)
            path.Insert(0, new PackageLink(up.Id, up.Number, up.Title));
        var branches = (children.GetValueOrDefault(package.Id) ?? []).Select(id =>
        {
            var b = all[id];
            return new BranchView(b.Id, b.Number, b.Title, b.State, children.GetValueOrDefault(id)?.Count ?? 0, Tally(id, Under(id)));
        }).ToList();
        return new PackagePlace(package.ParentId is { } p && all.ContainsKey(p) ? p : null, path, branches, Tally(package.Id, below));
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
    /// Sends the shortfall found by the last assessment to the acceptance authority, on a transmittal asking whether it
    /// may go without what is missing (a request; those putting it together copied in).
    /// </summary>
    public async Task<(Package? Package, IResult? Problem)> IssueShortfallAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var (package, problem) = await ComposableAsync(access, id, cancellationToken);
        if (problem is not null) return Fail(problem);
        if (package!.AssessedAt is null || package.Shortfall.Count == 0)
            return Fail(Problems.Conflict("NO_SHORTFALL", "Assess it first; a shortfall is what the assessment found missing."));
        var lines = package.Shortfall.Select(s => $"- {s.DocumentNumber}: {(s.Current is null ? "not released" : $"at {s.Current}")}, needs {string.Join(" or ", s.Required)}");
        var total = package.Members.Count;
        var asked = await Actions.ActionLetters.SendAsync(db, transmittals, clock, access.Project, Actor(access), Actions.ActionLetters.Request,
            $"{package.Number} — {package.Shortfall.Count} of {total} document{(total == 1 ? "" : "s")} not ready: may it go without them?",
            $"{package.Title} is due{(package.CompletionDate is { } due ? $" {due:yyyy-MM-dd}" : "")}. These are not at the status it needs:\n{string.Join("\n", lines)}\n\n"
                + "Confirm on the package to deliver it as it stands, on your responsibility; or wait for them.",
            package.AcceptorIds, package.OwnerIds, null, cancellationToken, packageId: package.Id);
        if (asked is null)
            return Fail(Problems.Conflict("NOBODY_TO_ASK", "Nobody who accepts this package is active on the project. Change who accepts it first."));
        package.ShortfallIssuedAt = clock.GetCurrentInstant();
        await audit.WriteAsync(Actor(access), "SHORTFALL_ISSUED", "Package", package.Id, package.Number,
            $"{package.Shortfall.Count} document(s) not ready, sent to the acceptance authority on {asked.Number}.", package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (package, null);
    }

    /// <summary>
    /// The acceptance authority agrees it goes without what is missing, on their responsibility: their confirmation
    /// answers the request on a transmittal, and the package is delivered at once, the documents not ready going as
    /// they stand (their released revision, else their newest). Recorded with their name.
    /// </summary>
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
        await SyncAsync(package, cancellationToken);
        var readiness = await ReadinessAsync(package, cancellationToken);
        var recorded = package.Shortfall.Select(s => s.DocumentId).ToHashSet();
        if (readiness.Any(r => !r.Ready && !recorded.Contains(r.Member.DocumentId)))
        {
            return Fail(Problems.Conflict("SHORTFALL_CHANGED",
                "Something else is missing since you were asked. It is checked and asked again before it goes."));
        }
        var note = Blank(request.Note);
        var actor = Actor(access);
        package.ShortfallAcceptedAt = clock.GetCurrentInstant();
        package.ShortfallAcceptedByName = access.UserName;
        await audit.WriteAsync(actor, "SHORTFALL_ACCEPTED", "Package", package.Id, package.Number,
            $"Goes without {string.Join(", ", package.Shortfall.Select(s => s.DocumentNumber))} ready, on the responsibility of {access.UserName}. {note}".Trim(),
            package.ProjectId, cancellationToken);
        // The confirmation answers the request it was asked on.
        var question = await db.Transmittals.AsNoTracking()
            .Where(t => t.PackageId == package.Id && t.Reason == Actions.ActionLetters.Request && t.Items.Count == 0)
            .OrderByDescending(t => t.IssuedAt).Select(t => new { t.Id, t.IssuedById }).FirstOrDefaultAsync(cancellationToken);
        await Actions.ActionLetters.SendAsync(db, transmittals, clock, access.Project, actor, Actions.ActionLetters.Confirmation,
            $"{package.Number} — goes without what is missing, on my responsibility",
            $"{package.Title} is delivered as it stands: {package.Shortfall.Count} document(s) not at the status it needs ({string.Join(", ", package.Shortfall.Select(s => s.DocumentNumber))}).{(note is null ? "" : $"\n\n{note}")}",
            question?.IssuedById is { } asker ? new[] { asker } : package.OwnerIds, package.OwnerIds, question?.Id, cancellationToken, packageId: package.Id);
        var (_, problem) = await DeliverNowAsync(access, package, readiness, note, access.UserName, cancellationToken);
        if (problem is not null) return Fail(problem);
        return (package, null);
    }

    // ── Delivering and accepting ──────────────────────────────────────────────

    /// <summary>
    /// Deliver: one transmittal per organization, carrying every member that is
    /// ready. Not while anything is missing that the acceptance authority has not
    /// accepted (accepting it delivers it), and not while a rule is still admitting. Its contents are then fixed.
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
                ? Problems.Conflict("SHORTFALL_NOT_ISSUED", "Some documents are not ready. Send what is missing to the acceptance authority first.")
                : Problems.Conflict("SHORTFALL_NOT_ACCEPTED", "Delivery waits for the acceptance authority to accept what is missing."));
        }
        if (package.Rule is not null && !request.RuleCeased)
        {
            return (null, [], Problems.Conflict("RULE_STILL_ADMITTING",
                "The package fills itself by a rule. Say that nothing more will join before it goes."));
        }
        var (sent, failed) = await DeliverNowAsync(access, package, readiness, Blank(request.Note), null, cancellationToken);
        return failed is null ? (package, sent, null) : (null, [], failed);
    }

    /// <summary>
    /// Sends the package: one transmittal per organization it goes to, with every ready document at its released
    /// revision; with <paramref name="onResponsibilityOf"/>, the documents not ready go too as they stand (their released
    /// revision, else their newest), said on the transmittal. A document with no revision at all cannot go and is named.
    /// Then the package is delivered (closed when it names nobody) and its contents are fixed.
    /// </summary>
    private async Task<(IReadOnlyList<Transmittal> Sent, IResult? Problem)> DeliverNowAsync(ProjectAccess access, Package package,
        List<Readiness> readiness, string? note, string? onResponsibilityOf, CancellationToken cancellationToken)
    {
        var ready = readiness.Where(r => r.Ready).ToList();
        var notReady = onResponsibilityOf is null ? [] : readiness.Where(r => !r.Ready).ToList();
        var ids = ready.Concat(notReady).Select(r => r.Member.DocumentId).ToList();
        var documents = await db.Documents.Where(d => ids.Contains(d.Id)).ToDictionaryAsync(d => d.Id, cancellationToken);
        var candidates = await db.Revisions.Where(r => ids.Contains(r.DocumentId) && r.VoidedAt == null).ToListAsync(cancellationToken);
        // The released revision when there is one; else, on the acceptor's responsibility, the newest.
        Revision? Going(Readiness r) =>
            (r.RevisionId is { } released ? candidates.FirstOrDefault(c => c.Id == released) : null)
            ?? (onResponsibilityOf is null ? null
                : candidates.Where(c => c.DocumentId == r.Member.DocumentId).OrderByDescending(c => c.CreatedAt).FirstOrDefault());
        var going = ready.Concat(notReady).Select(r => (Line: r, Revision: Going(r))).ToList();
        var items = going.Where(g => g.Revision is not null).Select(g => (documents[g.Line.Member.DocumentId], g.Revision!)).ToList();
        var left = going.Where(g => g.Revision is null).Select(g => g.Line.DocumentNumber).ToList();
        if (package.RecipientPartyIds.Length > 0 && items.Count == 0)
        {
            return ([], onResponsibilityOf is null
                ? Problems.Conflict("NOTHING_READY", "Nothing is ready to deliver.")
                : Problems.Conflict("NOTHING_TO_SEND", "None of its documents has a revision to send yet: there is nothing to deliver."));
        }
        var message = AlsoFor(package, note);
        if (onResponsibilityOf is not null && notReady.Count > 0)
        {
            var said = $"Delivered with {notReady.Count} document(s) not at the status asked ({string.Join(", ", notReady.Select(r => r.DocumentNumber))}), on the responsibility of {onResponsibilityOf}."
                + (left.Count > 0 ? $" Not sent, no revision yet: {string.Join(", ", left)}." : "");
            message = message is null ? said : $"{said}\n\n{message}";
        }

        var now = clock.GetCurrentInstant();
        var actor = Actor(access);
        var sent = new List<Transmittal>();
        if (package.RecipientPartyIds.Length > 0)
        {
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
                    $"{package.Number} {package.Title}: {items.Count} document(s)", message, party, party.Name,
                    items, addressees, PackageId: package.Id), cancellationToken));
            }
        }

        package.State = sent.Count > 0 ? PackageStates.Delivered : PackageStates.Closed;
        package.ClosedAt = now;
        package.ClosedByName = access.UserName;
        package.ClosureNote = note;
        if (package.Rule is not null) package.RuleCeasedAt = now;
        await audit.WriteAsync(actor, sent.Count > 0 ? "PACKAGE_DELIVERED" : "PACKAGE_CLOSED", "Package", package.Id, package.Number,
            sent.Count > 0 ? $"{items.Count} of {readiness.Count} document(s) on {string.Join(", ", sent.Select(t => t.Number))}{(onResponsibilityOf is null ? "" : $", on the responsibility of {onResponsibilityOf}")}."
                : $"Closed with {ready.Count} of {readiness.Count} document(s) ready; nobody to deliver it to.",
            package.ProjectId, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return (sent, null);
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
        package.AcceptNote = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
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
        // Supplier documents registered before packages were made by themselves join their package now.
        if (access.IsInternal && (access.Holds(Verbs.Control) || await StandIns.NoControlAsync(db, access.Project.Id, cancellationToken)))
            await filing.FileUnfiledAsync(access.Project, Actor(access), cancellationToken);
        var rows = await Visible(access)
            .OrderByDescending(p => p.CreatedAt).Take(500)
            .Select(p => new
            {
                p.Id,
                p.Number,
                p.ParentId,
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
            p.CompletionDate?.ToDateOnly(), p.CreatedAt.ToDateTimeOffset(), p.Kind, p.Supplier, p.PurchaseOrder, p.ParentId)).ToList();
    }

    /// <summary>The package, brought up to date with its rule.</summary>
    public async Task<Package?> ReadAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var package = await LoadAsync(access, id, cancellationToken);
        if (package is null) return null;
        var handed = await HandDownAsync(package, cancellationToken);
        if (await SyncAsync(package, cancellationToken) > 0 || handed)
        {
            ResetAssessment(package);
            await db.SaveChangesAsync(cancellationToken);
        }
        return package;
    }

    /// <summary>
    /// One package per document in a tree (owner): what this open package holds that a package under it holds too goes to
    /// the one under it, the lowest; this one no longer takes it back. Held twice from before the rule, it settles on its
    /// first reading; recorded. One already sent to the supplier stays where it was asked.
    /// </summary>
    private async Task<bool> HandDownAsync(Package package, CancellationToken cancellationToken)
    {
        if (package.State != PackageStates.Open || package.Members.Count == 0) return false;
        var all = await db.Packages.AsNoTracking().Where(p => p.ProjectId == package.ProjectId && p.Kind == package.Kind)
            .Select(p => new { p.Id, p.ParentId, p.Number }).ToListAsync(cancellationToken);
        var children = all.Where(p => p.ParentId is not null).GroupBy(p => p.ParentId!.Value).ToDictionary(g => g.Key, g => g.Select(p => p.Id).ToList());
        var below = new HashSet<Guid>();
        var queue = new Queue<Guid>([package.Id]);
        while (queue.TryDequeue(out var at))
            foreach (var child in children.GetValueOrDefault(at) ?? [])
                if (below.Add(child) && child != package.Id) queue.Enqueue(child);
        below.Remove(package.Id);
        if (below.Count == 0) return false;
        var mine = package.Members.Where(m => m.RequestedAt is null).Select(m => m.DocumentId).ToList();
        var lower = await db.PackageMembers.AsNoTracking().Where(m => below.Contains(m.PackageId) && mine.Contains(m.DocumentId))
            .Select(m => new { m.DocumentId, m.PackageId }).ToListAsync(cancellationToken);
        if (lower.Count == 0) return false;
        var going = lower.Select(m => m.DocumentId).ToHashSet();
        var leaving = package.Members.Where(m => going.Contains(m.DocumentId)).ToList();
        foreach (var member in leaving) package.Members.Remove(member);
        db.PackageMembers.RemoveRange(leaving);
        package.Excluded = package.Excluded.Union(going).ToArray();
        var numbers = all.Where(p => lower.Any(m => m.PackageId == p.Id)).Select(p => p.Number).Distinct().OrderBy(n => n);
        await audit.WriteAsync(new Actor(null, "System"), "PACKAGE_MEMBERS_REMOVED", "Package", package.Id, package.Number,
            $"{going.Count} document(s) held lower in its tree, in {string.Join(", ", numbers)}: they sit there only.", package.ProjectId, cancellationToken);
        return true;
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
    /// <summary>
    /// The supplier's people on the package's project (active, not waiting for confirmation): who sees it once shared,
    /// and who is told.
    /// </summary>
    public async Task<IReadOnlyList<(Guid Id, string Name)>> SupplierPeopleAsync(Package package, CancellationToken cancellationToken)
    {
        if (package.SupplierPartyId is not { } party) return [];
        var rows = await (from u in db.Users
                          join m in db.Memberships on u.Id equals m.UserId
                          where u.PartyId == party && u.Active && m.ProjectId == package.ProjectId && m.Active && m.PendingSince == null
                          select new { u.Id, u.Name }).Distinct().AsNoTracking().ToListAsync(cancellationToken);
        return rows.Select(r => (r.Id, r.Name)).ToList();
    }

    public async Task<string?> SupplierNameAsync(Package package, CancellationToken cancellationToken) =>
        package.SupplierPartyId is { } id ? await db.Parties.Where(p => p.Id == id).Select(p => p.Name).SingleOrDefaultAsync(cancellationToken) : null;

    /// <summary>
    /// A package's people in words. It goes to its supplier, or to its recipients (one that is not an outside
    /// organization is us, by the organization's name). Delivered: closed by delivering, or accepted after going out.
    /// </summary>
    public async Task<PackageNames> NamesAsync(Package package, IReadOnlyList<PackageTransmittal> transmittals, CancellationToken cancellationToken)
    {
        var people = package.OwnerIds.Concat(package.AcceptorIds).ToList();
        var names = await db.Users.AsNoTracking().Where(u => people.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Name, cancellationToken);
        string Names(IEnumerable<Guid> ids) => string.Join(", ", ids.Select(id => names.GetValueOrDefault(id)).OfType<string>());
        var partyIds = package.RecipientPartyIds.Append(package.SupplierPartyId ?? Guid.Empty).ToList();
        var parties = await db.Parties.AsNoTracking().Where(p => partyIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, cancellationToken);
        var us = await db.Tenants.AsNoTracking().Where(t => t.Id == package.TenantId).Select(t => t.Name).FirstOrDefaultAsync(cancellationToken) ?? "us";
        var supplier = package.SupplierPartyId is { } s ? parties.GetValueOrDefault(s) : null;
        var to = package.Kind == PackageKinds.Supply ? supplier?.Name ?? ""
            : string.Join(", ", package.RecipientPartyIds.Select(id => parties.GetValueOrDefault(id) is { IsInternal: false } p ? p.Name : us));
        var owners = Names(package.OwnerIds);
        var delivered = package.State == PackageStates.Delivered
            || (package.State == PackageStates.Accepted && transmittals.Any(t => t.Direction == Transmittals.TransmittalDirections.Outgoing));
        return new PackageNames(to, owners.Length > 0 ? owners : package.CreatedByName, Names(package.AcceptorIds),
            supplier?.Code ?? package.Rule?.Originators.FirstOrDefault(), package.CreatedAt.ToDateTimeOffset(),
            delivered ? package.ClosedAt?.ToDateTimeOffset() : null);
    }

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
        // A supplier's packages are one per purchase order: one with none holds what is under none.
        if (package.Kind == PackageKinds.Supply)
            query = package.PurchaseOrder is { } order ? query.Where(d => d.ContractRef == order)
                : query.Where(d => d.ContractRef == null || d.ContractRef == "");
        // What a supplier owes is what was planned; something it sent unplanned (an RFI, an NCR) and we registered is not.
        if (package.Kind == PackageKinds.Supply)
            query = query.Where(d => !db.TransmittalItems.Any(i => i.DocumentId == d.Id && i.Kind == TransmittalItemKinds.Unplanned));
        // One package per document: one another package of its tree (a supplier's: of its supplier) holds is not taken.
        var others = await SharingAsync(package, cancellationToken);
        if (others.Count > 0) query = query.Where(d => !db.PackageMembers.Any(m => m.DocumentId == d.Id && others.Contains(m.PackageId)));
        var have = package.Members.Select(m => m.DocumentId).Concat(package.Excluded).ToList();
        var fresh = await query.Where(d => !have.Contains(d.Id)).Select(d => d.Id).ToListAsync(cancellationToken);
        foreach (var documentId in fresh) package.Members.Add(NewMember(package, documentId, [], byRule: true));
        return fresh.Count;
    }

    /// <summary>
    /// The packages a document of this one may not also sit in (owner: one package per document): for a delivery package,
    /// every other package of its tree (from the top one down); for a supplier's, every other package of that supplier.
    /// </summary>
    private async Task<List<Guid>> SharingAsync(Package package, CancellationToken cancellationToken)
    {
        if (package.Kind == PackageKinds.Supply)
            return await db.Packages.AsNoTracking().Where(p => p.ProjectId == package.ProjectId && p.Kind == PackageKinds.Supply
                && p.SupplierPartyId == package.SupplierPartyId && p.Id != package.Id).Select(p => p.Id).ToListAsync(cancellationToken);
        var all = await db.Packages.AsNoTracking().Where(p => p.ProjectId == package.ProjectId && p.Kind == package.Kind)
            .Select(p => new { p.Id, p.ParentId }).ToListAsync(cancellationToken);
        var parents = all.ToDictionary(p => p.Id, p => p.ParentId);
        // Climb to the top (a package being made is not saved yet: start from the one it goes in).
        var root = package.Id;
        var guard = new HashSet<Guid> { root };
        for (var up = package.ParentId; up is { } step && guard.Add(step); up = parents.GetValueOrDefault(step)) root = step;
        var children = all.Where(p => p.ParentId is not null).GroupBy(p => p.ParentId!.Value).ToDictionary(g => g.Key, g => g.Select(p => p.Id).ToList());
        var tree = new List<Guid> { root };
        var seen = new HashSet<Guid> { root };
        var queue = new Queue<Guid>([root]);
        while (queue.TryDequeue(out var at))
            foreach (var child in children.GetValueOrDefault(at) ?? [])
                if (seen.Add(child)) { tree.Add(child); queue.Enqueue(child); }
        return tree.Where(id => id != package.Id).ToList();
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
    /// Loads a package the caller may change: they must hold Control (or, for its documents only, be putting it
    /// together), and it must still be open.
    /// Otherwise returns the problem to answer with.
    /// </summary>
    private async Task<(Package?, IResult?)> ComposableAsync(ProjectAccess access, Guid id, CancellationToken cancellationToken, bool members = false)
    {
        var package = await LoadAsync(access, id, cancellationToken);
        if (package is null) return (null, NotFound());
        // Those putting it together add and take out its documents; everything else is the control function's (and above).
        // With no control function, those putting a delivery together do everything on it, and a supplier's package is
        // looked after by whoever of ours may send or register documents.
        var noControl = access.IsInternal && !access.Holds(Verbs.Control) && await StandIns.NoControlAsync(db, access.Project.Id, cancellationToken);
        var standsIn = noControl && (package.Kind == PackageKinds.Supply
            ? access.Holds(Verbs.Transmit) || access.Holds(Verbs.Create)
            : package.OwnerIds.Contains(access.UserId));
        if (!access.IsInternal || !(access.Holds(Verbs.Control) || standsIn || (members && package.OwnerIds.Contains(access.UserId))))
            return (null, members
                ? Problems.Forbidden("OWNER_ONLY", "Those putting it together, or the control function, add and take out its documents.")
                : Problems.Forbidden("CONTROL_ONLY", "The control function looks after a package; those putting it together add and take out its documents."));
        // A supplier's package is the control function's alone.
        if (package.Kind == PackageKinds.Supply && !access.Holds(Verbs.Control) && !standsIn)
            return (null, Problems.Forbidden("CONTROL_ONLY", "The control function looks after a supplier's package."));
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
        // Shared with them, once and for good; until then the package is ours alone.
        return query.Where(p => p.Kind == PackageKinds.Supply && p.SharedAt != null && db.Parties.Any(x => x.Id == p.SupplierPartyId && x.Code == code));
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

    /// <summary>
    /// Why they get it, read from the status it needs (the first of them): the published reason for issue saying the
    /// same purpose ("Issued for review" → "For review"), else one for execution when the status lets work go ahead,
    /// else the first reason that carries documents. Null when nothing is published.
    /// </summary>
    private static string? ReasonFor(Catalog catalog, IReadOnlyList<string> statuses)
    {
        var reasons = catalog.Active(TransmittalSets.Reasons)
            .Where(r => catalog.Prop(TransmittalSets.Reasons, r.Code, "family") is not { ValueKind: System.Text.Json.JsonValueKind.String } f || f.GetString() == "Data")
            .ToList();
        if (reasons.Count == 0) return null;
        static string Purpose(string label)
        {
            var at = label.IndexOf(" for ", StringComparison.OrdinalIgnoreCase);
            var rest = at >= 0 ? label[(at + 5)..] : label.StartsWith("For ", StringComparison.OrdinalIgnoreCase) ? label[4..] : label;
            return rest.Trim().ToLowerInvariant();
        }
        foreach (var status in statuses)
        {
            var purpose = Purpose(catalog.Label(Reviews.ReviewSets.Statuses, status));
            if (reasons.FirstOrDefault(r => Purpose(r.Label) == purpose) is { Code: { Length: > 0 } same }) return same;
            if (catalog.Prop(Reviews.ReviewSets.Statuses, status, "executes") is { ValueKind: System.Text.Json.JsonValueKind.True }
                && reasons.FirstOrDefault(r => catalog.Prop(TransmittalSets.Reasons, r.Code, "executes") is { ValueKind: System.Text.Json.JsonValueKind.True }) is { Code: { Length: > 0 } go })
                return go;
        }
        return reasons[0].Code;
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
