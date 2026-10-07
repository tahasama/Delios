using System.Text.Json;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Reviews;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Seeding;

/// <summary>
/// A demo tenant to try the system with: people in each function on one project.
/// Every password is <c>demo1234</c>. Development only.
/// </summary>
public sealed class DemoSeed(DeliosDbContext db, TenantSetup setup, Tenancy.TenantContext tenantContext, ILogger<DemoSeed> logger)
{
    public const string Slug = "demo";
    public const string Password = "demo1234";

    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        if (await db.Tenants.SingleOrDefaultAsync(t => t.Slug == Slug, cancellationToken) is { } existing)
        {
            // A demo created by an earlier version gains what it lacks; nothing it has is touched.
            tenantContext.Set(existing.Id);
            await using var upgrade = await db.Database.BeginTransactionAsync(cancellationToken);
            var reviews = await EnsureReviewSetupAsync(existing.Id, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            var issuing = await EnsureIssueSetupAsync(existing.Id, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            issuing |= await EnsurePackageSetupAsync(existing.Id, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            issuing |= await EnsureControlSetupAsync(existing.Id, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            await upgrade.CommitAsync(cancellationToken);
            logger.LogInformation(reviews || issuing ? "The demo tenant exists; what it lacked was added" : "The demo tenant already exists; nothing to do");
            return;
        }

        var tenant = await setup.CreateAsync(Slug, "Demo Engineering", "admin@demo.local", "Ada Admin", Password, cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var t = tenant.Id;

        var own = new Party { TenantId = t, Code = "DEMO", Name = "Demo Engineering", IsInternal = true };
        var acme = new Party { TenantId = t, Code = "ACME", Name = "Acme Pumps" };
        db.Parties.AddRange(own, acme);

        Function Fn(string code, string name, params string[] verbs) => new()
        {
            TenantId = t,
            Code = code,
            Name = name,
            Rules = [new PermissionRule { TenantId = t, Verbs = verbs }],
        };
        var control = Fn("DC", "Document Control", [.. Verbs.All]);
        var engineer = Fn("ENG", "Engineer", Verbs.Read, Verbs.Create, Verbs.Revise, Verbs.Review);
        var approver = Fn("APP", "Approver", Verbs.Read, Verbs.Review, Verbs.Approve);
        var viewer = Fn("VIEW", "Viewer", Verbs.Read, Verbs.Receive);
        var supplier = Fn("SUP", "Supplier", Verbs.Read, Verbs.Revise);
        db.Functions.AddRange(control, engineer, approver, viewer, supplier);

        var project = new Project
        {
            TenantId = t,
            Code = "P1001",
            Name = "Wastewater treatment works",
            ContractRole = "EPC",
            TimeZone = "UTC",
        };
        db.Projects.Add(project);

        var admin = await db.Users.SingleAsync(u => u.NormalizedEmail == "ADMIN@DEMO.LOCAL", cancellationToken);
        var people = new (Identity.User User, Function Function)[]
        {
            (admin, control),
            (setup.NewUser(t, "controller@demo.local", "Carla Control", Password), control),
            (setup.NewUser(t, "engineer@demo.local", "Eli Engineer", Password), engineer),
            (setup.NewUser(t, "approver@demo.local", "Aisha Approver", Password), approver),
            (setup.NewUser(t, "viewer@demo.local", "Victor Viewer", Password), viewer),
            (setup.NewUser(t, "supplier@acme.local", "Sam Supplier", Password, partyId: acme.Id), supplier),
        };
        foreach (var (user, function) in people)
        {
            if (user != admin) db.Users.Add(user);
            db.Memberships.Add(new Membership { TenantId = t, ProjectId = project.Id, UserId = user.Id, FunctionId = function.Id });
        }

        AddConfiguration(t);
        await EnsureReviewSetupAsync(t, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await EnsureIssueSetupAsync(t, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await EnsurePackageSetupAsync(t, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await EnsureControlSetupAsync(t, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        logger.LogInformation("Demo tenant '{Slug}' created; every password is {Password}", Slug, Password);
    }

    /// <summary>The published lists and numbering a project needs before its first document.</summary>
    private void AddConfiguration(Guid t)
    {
        void Set(string key, params (string Code, string Label, object? Props)[] values) => AddSet(t, key, values);

        Set(ValueSets.Disciplines,
            ("CI", "Civil", null), ("EL", "Electrical", null), ("ME", "Mechanical", null), ("PR", "Process", null),
            ("IN", "Instrumentation", null), ("ST", "Structural", null), ("GE", "General", null), ("PM", "Project Management", null));
        Set(ValueSets.DocumentTypes,
            ("DWG", "Drawing", null), ("CAL", "Calculation", null), ("SPC", "Specification", null), ("DAS", "Datasheet", null),
            ("PRO", "Procedure", null), ("REP", "Report", null), ("LST", "List", null));
        Set(ValueSets.DeliverableTypes,
            ("ENG", "Engineering Document", null),
            ("SUP", "Supplier Data", new { required = new[] { "originator", "contractRef", "receivedDate" } }));
        Set(ValueSets.Subprojects, ("00", "Project-wide", null), ("10", "General", null), ("20", "Inlet works", null));
        Set(ValueSets.PurchaseOrders, ("PO101", "Acme Pumps: duty pumps", null));
        Set(ValueSets.RetentionClasses,
            ("PROJECT_DURATION", "Project duration", new { @default = true }),
            ("LIFE_OF_ASSET", "Life of asset", null), ("PERMANENT", "Permanent", null));
        Set(ValueSets.Criticality,
            ("A", "High", new { retention = "PERMANENT" }), ("B", "Medium", new { retention = "LIFE_OF_ASSET" }),
            ("C", "Low", new { retention = "PROJECT_DURATION" }));
        Set(ValueSets.Confidentiality,
            ("PUBLIC", "Public", null), ("INTERNAL", "Internal", new { @default = true }),
            ("CONFIDENTIAL", "Confidential", new { restricted = true }));

        // The recommendation, as data the administrator can change.
        Set(ValueSets.GenericTitleWords, [.. new[]
        {
            "report", "drawing", "layout", "document", "specification", "spec", "sketch", "plan", "note", "memo",
            "list", "schedule", "calculation", "datasheet", "procedure", "manual", "untitled", "test",
        }.Select(w => (w, w, (object?)null))]);
        db.RevisionSchemes.Add(new RevisionScheme
        {
            TenantId = t,
            Name = "Recommended",
            IsDefault = true,
            Series =
            [
                new()
                {
                    Code = "DESIGN", Label = "Design", Kind = SeriesKinds.Letters, Start = "A",
                    ExcludedLetters = ["I", "O", "Q", "S", "X", "Z"],
                },
                new() { Code = "EXECUTION", Label = "Execution", Kind = SeriesKinds.Numbers, Start = "0" },
            ],
        });

        var internalScheme = new NumberingScheme
        {
            TenantId = t,
            Name = "Non-supplier",
            Fields =
            [
                new() { Label = "Project code", Source = FieldSources.Project },
                new() { Label = "Subproject", Source = FieldSources.Subproject },
                new() { Label = "Discipline", Source = FieldSources.Discipline },
                new() { Label = "Document type", Source = FieldSources.DocType },
                new() { Label = "Sequence", Source = FieldSources.Sequence, Digits = 5 },
            ],
        };
        var supplierScheme = new NumberingScheme
        {
            TenantId = t,
            Name = "Supplier",
            Fields =
            [
                new() { Label = "Project code", Source = FieldSources.Project },
                new() { Label = "Subproject", Source = FieldSources.Subproject },
                new() { Label = "Supplier code", Source = FieldSources.Originator },
                new() { Label = "Purchase order", Source = FieldSources.ContractRef },
                new() { Label = "Discipline", Source = FieldSources.Discipline },
                new() { Label = "Document type", Source = FieldSources.DocType },
                new() { Label = "Sequence", Source = FieldSources.Sequence, Digits = 5 },
            ],
        };
        db.NumberingSchemes.AddRange(internalScheme, supplierScheme);
        db.SchemeRoutings.AddRange(
            new SchemeRouting { TenantId = t, DeliverableType = "ENG", SchemeId = internalScheme.Id },
            new SchemeRouting { TenantId = t, DeliverableType = "SUP", SchemeId = supplierScheme.Id });
    }

    /// <summary>
    /// Reviews: what a released revision may be for, what a decider may say, what
    /// an adviser's comments amount to, a route and the review numbers. The
    /// recommendation, as data. Adds only what is missing.
    /// </summary>
    private async Task<bool> EnsureReviewSetupAsync(Guid t, CancellationToken cancellationToken)
    {
        if (await db.ReviewRoutes.AnyAsync(cancellationToken)) return false;
        void Set(string key, params (string Code, string Label, object? Props)[] values) => AddSet(t, key, values);

        var reviewScheme = new NumberingScheme
        {
            TenantId = t,
            Name = "Reviews",
            Fields =
            [
                new() { Label = "Project code", Source = FieldSources.Project },
                new() { Label = "Record", Source = FieldSources.Fixed, Value = "RV" },
                new() { Label = "Sequence", Source = FieldSources.Sequence, Digits = 4 },
            ],
        };
        db.NumberingSchemes.Add(reviewScheme);
        db.SchemeRoutings.Add(new SchemeRouting { TenantId = t, DeliverableType = RecordKinds.Review, SchemeId = reviewScheme.Id });

        Set(ReviewSets.Statuses,
            ("IFI", "Issued for information", new { executes = false }),
            ("IFR", "Issued for review", new { executes = false }),
            ("IFA", "Issued for approval", new { executes = false }),
            ("IFC", "Issued for construction", new { executes = true }),
            ("AFC", "Approved for construction", new { executes = true }));
        Set(ReviewSets.Verdicts,
            ("C1", "Accepted", new { proceed = true }),
            ("C2", "Accepted with comments", new { proceed = true }),
            ("C3", "Rejected: revise and resubmit", new { proceed = false }),
            ("C4", "For information only", new { proceed = true }));
        Set(ReviewSets.Advice,
            ("NO_COMMENT", "No comment", new { comments = "none" }),
            ("COMMENTS", "Comments, none blocking", new { comments = "some" }),
            ("COMMENTS_BLOCKING", "Blocking comments", new { comments = "blocking" }));
        Set(ReviewSets.CommentClasses,
            ("BLOCKING", "Class 1: blocking", new { blocking = true }),
            ("NON_BLOCKING", "Class 2: not blocking", new { blocking = false }));
        Set(ReviewSets.ReturnReasons,
            ("WRONG_FILE", "The wrong file was attached", null),
            ("WRONG_PEOPLE", "The wrong people were on a step", null),
            ("STEP_SKIPPED", "A step was missed", null),
            ("ANSWER_IN_ERROR", "An answer was recorded in error", null));
        db.ReviewRoutes.Add(new ReviewRoute
        {
            TenantId = t,
            Name = "Discipline check, then approval",
            IsDefault = true,
            Description = "The discipline engineer checks; the approver decides.",
            Steps =
            [
                new() { Title = "Discipline check", FunctionCode = "ENG", Days = 5 },
                new() { Title = "Approval", FunctionCode = "APP", Days = 3, GrantsStatuses = ["IFI", "IFR", "IFA", "IFC", "AFC"] },
            ],
        });
        return true;
    }

    /// <summary>
    /// Issuing: why things are sent, transmittal numbers, a client that answers
    /// by proxy and a route that ends with their approval. Adds only what is missing.
    /// </summary>
    private async Task<bool> EnsureIssueSetupAsync(Guid t, CancellationToken cancellationToken)
    {
        if (await db.ValueEntries.AnyAsync(v => v.SetKey == Transmittals.TransmittalSets.Reasons, cancellationToken)) return false;

        AddSet(t, Transmittals.TransmittalSets.Reasons,
        [
            ("INFORMATION", "For information", new { response = false }),
            ("REVIEW", "For review", new { response = true, responseDays = 10 }),
            ("APPROVAL", "For approval", new { response = true, responseDays = 10 }),
            ("PRICING", "For pricing", new { response = true, responseDays = 15 }),
            ("EXECUTION", "For execution", new { response = false }),
            ("RECORD", "For record", new { response = false }),
        ]);
        var scheme = new NumberingScheme
        {
            TenantId = t,
            Name = "Transmittals",
            Fields =
            [
                new() { Label = "Project code", Source = FieldSources.Project },
                new() { Label = "From", Source = FieldSources.Sender },
                new() { Label = "To", Source = FieldSources.Receiver },
                new() { Label = "Record", Source = FieldSources.Fixed, Value = "TR" },
                new() { Label = "Sequence", Source = FieldSources.Sequence, Digits = 4 },
            ],
        };
        db.NumberingSchemes.Add(scheme);
        db.SchemeRoutings.Add(new SchemeRouting { TenantId = t, DeliverableType = RecordKinds.Transmittal, SchemeId = scheme.Id });

        // The client works in its own system: Document Control sends and records their answers.
        db.Parties.Add(new Party
        {
            TenantId = t,
            Code = "NWU",
            Name = "Northwater Utility",
            Participation = Participations.ByProxy,
            ExternalSystem = "Client document portal",
            EvidenceRequired = true,
        });
        db.ReviewRoutes.Add(new ReviewRoute
        {
            TenantId = t,
            Name = "Discipline check, then client approval",
            Description = "High-criticality documents: the discipline engineer checks, the client decides.",
            Patterns = [new() { Criticality = "A" }],
            Steps =
            [
                new() { Title = "Discipline check", FunctionCode = "ENG", Days = 5 },
                new() { Title = "Client approval", PartyCode = "NWU", Reason = "APPROVAL", Days = 10, GrantsStatuses = ["AFC"] },
            ],
        });

        // Viewers are on the distribution: the matrix says who receives what.
        var viewer = await db.Functions.Include(f => f.Rules).SingleOrDefaultAsync(f => f.Code == "VIEW", cancellationToken);
        if (viewer?.Rules.FirstOrDefault() is { } rule && !rule.Verbs.Contains(Verbs.Receive))
        {
            rule.Verbs = [.. rule.Verbs, Verbs.Receive];
        }
        return true;
    }

    /// <summary>Package numbers: P1001-PK-001. The recommendation, as data.</summary>
    private async Task<bool> EnsurePackageSetupAsync(Guid t, CancellationToken cancellationToken)
    {
        if (await db.SchemeRoutings.AnyAsync(r => r.DeliverableType == RecordKinds.Package, cancellationToken)) return false;
        var scheme = new NumberingScheme
        {
            TenantId = t,
            Name = "Packages",
            Fields =
            [
                new() { Label = "Project code", Source = FieldSources.Project },
                new() { Label = "Record", Source = FieldSources.Fixed, Value = "PK" },
                new() { Label = "Sequence", Source = FieldSources.Sequence, Digits = 3 },
            ],
        };
        db.NumberingSchemes.Add(scheme);
        db.SchemeRoutings.Add(new SchemeRouting { TenantId = t, DeliverableType = RecordKinds.Package, SchemeId = scheme.Id });
        return true;
    }

    /// <summary>
    /// Document Control's own outcomes, apart from review verdicts. Returning a
    /// submission that is not in order keeps its revision; only the outcome for a
    /// verdict that asked for changes needs a new one. The recommendation, as data.
    /// </summary>
    private async Task<bool> EnsureControlSetupAsync(Guid t, CancellationToken cancellationToken)
    {
        if (await db.ValueEntries.AnyAsync(v => v.SetKey == ReviewSets.ControlOutcomes, cancellationToken)) return false;
        AddSet(t, ReviewSets.ControlOutcomes,
        [
            ("ACCEPTED", "Accepted", new { act = "accept" }),
            ("RETURNED_TO_SENDER", "Returned to sender for correction", new { act = "return", to = "sender", newRevision = false }),
            ("RETURNED_TO_INITIATOR", "Returned to initiator for correction", new { act = "return", to = "initiator", newRevision = false }),
            ("RETURNED_FOR_REVISION", "Returned for a new revision", new { act = "return", newRevision = true }),
            ("RELEASED", "Released", new { act = "release" }),
        ]);
        return true;
    }

    private void AddSet(Guid t, string key, (string Code, string Label, object? Props)[] values)
    {
        var sort = 0;
        foreach (var (code, label, props) in values)
        {
            db.ValueEntries.Add(new ValueEntry
            {
                TenantId = t,
                SetKey = key,
                Code = code,
                Label = label,
                Sort = sort++,
                Props = props is null ? null : JsonSerializer.SerializeToDocument(props),
            });
        }
    }
}
