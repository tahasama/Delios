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
public sealed class DemoSeed(DeliosDbContext db, TenantSetup setup, Tenancy.TenantContext tenantContext, ILogger<DemoSeed> logger,
    Microsoft.AspNetCore.Identity.IPasswordHasher<Operators.Operator> operatorHasher)
{
    /// <summary>The demo's account in the DELIOS console (console@demo.local, the demo password), to try it out.</summary>
    public const string ConsoleEmail = "console@demo.local";

    /// <summary>
    /// A console account for the demo (owner: "console do not allow regular admin@demo.local"): the console never takes an
    /// organization's account, so the demo brings one of its own. Demo data only: seed-demo refuses Production unless forced.
    /// </summary>
    private async Task EnsureConsoleAccountAsync(CancellationToken cancellationToken)
    {
        var normalized = ConsoleEmail.ToUpperInvariant();
        if (await db.Set<Operators.Operator>().AnyAsync(o => o.NormalizedEmail == normalized, cancellationToken)) return;
        var who = new Operators.Operator { Email = ConsoleEmail, NormalizedEmail = normalized, Name = "Demo console", PasswordHash = "" };
        who.PasswordHash = operatorHasher.HashPassword(who, Password);
        db.Add(who);
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>The short name of the demo tenant.</summary>
    public const string Slug = "demo";
    /// <summary>The password of every demo user.</summary>
    public const string Password = "demo1234";

    /// <summary>
    /// Creates the demo tenant with its parties, functions, project, people and settings. If it already exists, only adds the setup that later versions brought.
    /// Called by the <c>seed-demo</c> command line command (refused in Production unless --force is given).
    /// </summary>
    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        await EnsureConsoleAccountAsync(cancellationToken);
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
            issuing |= await EnsureAssetSetupAsync(existing.Id, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            issuing |= await EnsureRevisionLinesAsync(cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            issuing |= await EnsureControlSetupAsync(existing.Id, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            issuing |= await EnsureScheduleSetupAsync(existing.Id, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            issuing |= await EnsureCorrespondenceSetupAsync(existing.Id, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            issuing |= await EnsureInformationReasonsAsync(existing.Id, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            issuing |= await EnsureUpdateStatusAsync(existing.Id, cancellationToken);
            issuing |= await EnsurePropNamesAsync(cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            await Organizations.Registry.EnsureTenantAsync(db, existing.Id, cancellationToken);
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

        var (control, engineer, approver, viewer, supplier) = AddFunctions(t);

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
        await EnsureAssetSetupAsync(t, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await EnsureControlSetupAsync(t, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await EnsureScheduleSetupAsync(t, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await EnsureCorrespondenceSetupAsync(t, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await Organizations.Registry.EnsureTenantAsync(db, t, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        logger.LogInformation("Demo tenant '{Slug}' created; every password is {Password}", Slug, Password);
    }

    /// <summary>The recommended functions, each with one matrix row: Document Control may do everything.</summary>
    private (Function Control, Function Engineer, Function Approver, Function Viewer, Function Supplier) AddFunctions(Guid t)
    {
        Function Fn(string code, string name, params string[] verbs) => new()
        {
            TenantId = t,
            Code = code,
            Name = name,
            Rules = [new PermissionRule { TenantId = t, Verbs = verbs }],
        };
        // Management confirms what Document Control checked: a second pair of eyes, so Document Control does not hold it.
        var control = Fn("DC", "Document Control", [.. Verbs.All.Where(v => v != Verbs.Manage)]);
        var engineer = Fn("ENG", "Engineer", Verbs.Read, Verbs.Create, Verbs.Revise, Verbs.Review);
        // The approver stands for the project manager in the demo.
        var approver = Fn("APP", "Approver", Verbs.Read, Verbs.Review, Verbs.Approve, Verbs.Manage);
        var viewer = Fn("VIEW", "Viewer", Verbs.Read, Verbs.Receive);
        var supplier = Fn("SUP", "Supplier", Verbs.Read, Verbs.Revise);
        db.Functions.AddRange(control, engineer, approver, viewer, supplier);
        return (control, engineer, approver, viewer, supplier);
    }

    /// <summary>
    /// An organization registering itself: the organization, its administrator, its own party, and the recommended
    /// configuration the demo runs on (functions, lists, numbering, a review route, reasons for issue), without the
    /// demo's people, parties or projects. With a project named, it is opened with the administrator on it as
    /// Document Control. Called by <c>POST /api/auth/sign-up</c>.
    /// </summary>
    public async Task<(Tenant Tenant, Guid AdminId)> StartAsync(
        string organizationName, string adminName, string email, string password, string? projectCode, string? projectName,
        string? contractRole, CancellationToken cancellationToken, string? projectKind = null)
    {
        var slugBase = new string(organizationName.ToLowerInvariant().Select(c => char.IsAsciiLetterOrDigit(c) ? c : '-').ToArray()).Trim('-');
        if (slugBase.Length == 0 || slugBase is Slug or "admin" or "api") slugBase = $"org-{slugBase}".TrimEnd('-');
        slugBase = slugBase[..Math.Min(slugBase.Length, 40)];
        var slug = slugBase;
        for (var n = 2; await db.Tenants.AnyAsync(x => x.Slug == slug, cancellationToken); n++) slug = $"{slugBase}-{n}";

        var tenant = await setup.CreateAsync(slug, organizationName, email, adminName, password, cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var t = tenant.Id;
        // Its code is its own across DELIOS: one nobody has had yet, from its name.
        var own = new Party { TenantId = t, Code = await Organizations.Registry.FreeOrganizationCodeAsync(db, organizationName, cancellationToken), Name = organizationName, IsInternal = true };
        db.Parties.Add(own);
        var (control, _, _, _, _) = AddFunctions(t);
        var admin = await db.Users.SingleAsync(u => u.TenantId == t && u.NormalizedEmail == email.Trim().ToUpperInvariant(), cancellationToken);
        admin.PartyId = own.Id;
        AddConfiguration(t, demo: false);
        await EnsureReviewSetupAsync(t, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await EnsureIssueSetupAsync(t, cancellationToken, demo: false);
        await db.SaveChangesAsync(cancellationToken);
        await EnsurePackageSetupAsync(t, cancellationToken);
        await EnsureAssetSetupAsync(t, cancellationToken);
        await EnsureControlSetupAsync(t, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await EnsureScheduleSetupAsync(t, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await EnsureCorrespondenceSetupAsync(t, cancellationToken);
        if (!string.IsNullOrWhiteSpace(projectCode) && !string.IsNullOrWhiteSpace(projectName))
        {
            var project = new Project
            {
                TenantId = t,
                Code = projectCode.Trim().ToUpperInvariant(),
                Name = projectName.Trim(),
                ContractRole = string.IsNullOrWhiteSpace(contractRole) ? "GENERIC" : contractRole.Trim().ToUpperInvariant(),
                Kind = string.IsNullOrWhiteSpace(projectKind) ? "GENERIC" : projectKind.Trim().ToUpperInvariant(),
            };
            db.Projects.Add(project);
            db.Memberships.Add(new Membership { TenantId = t, ProjectId = project.Id, UserId = admin.Id, FunctionId = control.Id });
        }
        // Trying DELIOS starts now, for as long as the DELIOS team set (Operators/Trials.cs).
        await Operators.Trials.StartAsync(db, t, NodaTime.SystemClock.Instance.GetCurrentInstant(), cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await Organizations.Registry.EnsureTenantAsync(db, t, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return (tenant, admin.Id);
    }

    /// <summary>The published lists and numbering a project needs before its first document.</summary>
    private void AddConfiguration(Guid t, bool demo = true)
    {
        void Set(string key, params (string Code, string Label, object? Props)[] values) => AddSet(t, key, values);

        Set(ValueSets.Disciplines,
            ("CI", "Civil", null), ("EL", "Electrical", null), ("ME", "Mechanical", null), ("PR", "Process", null),
            ("IN", "Instrumentation", null), ("ST", "Structural", null), ("GE", "General", null), ("PM", "Project Management", null));
        // Each type recommends a criticality; whoever creates a document may choose another.
        Set(ValueSets.DocumentTypes,
            ("DWG", "Drawing", new { criticality = "B" }), ("CAL", "Calculation", new { criticality = "A" }),
            ("SPC", "Specification", new { criticality = "B" }), ("DAS", "Datasheet", new { criticality = "B" }),
            ("PRO", "Procedure", new { criticality = "B" }), ("REP", "Report", new { criticality = "C" }), ("LST", "List", new { criticality = "C" }));
        Set(ValueSets.DeliverableTypes,
            ("ENG", "Engineering Document", null),
            ("SUP", "Supplier document", new { required = new[] { "originator", "contractRef" } }));
        // The project types it describes its projects with; the organization adds its own.
        Set(ValueSets.ProjectKinds, demo
            ? [("GENERIC", "General", null), ("INDUSTRIAL", "Industrial / process plant", null), ("ENERGY", "Energy / power", null), ("CONSTRUCTION", "Construction / buildings", null)]
            : [("GENERIC", "General", null)]);
        if (demo)
        {
            Set(ValueSets.Subprojects, ("00", "Project-wide", null), ("10", "General", null), ("20", "Inlet works", null));
            Set(ValueSets.PurchaseOrders, ("PO101", "Acme Pumps: duty pumps", null));
        }
        else
        {
            // A number is built from the sub-project, so there is always one to choose.
            Set(ValueSets.Subprojects, ("00", "Project-wide", null));
        }
        Set(ValueSets.RetentionClasses,
            ("PROJECT_DURATION", "Project duration", new { @default = true }),
            ("LIFE_OF_ASSET", "Life of asset", null), ("PERMANENT", "Permanent", null));
        Set(ValueSets.Criticality,
            ("A", "High", new { retention = "PERMANENT", meaning = "An error could hurt people or the environment, or stop the plant: design basis, calculations, safety studies." }),
            ("B", "Medium", new { retention = "LIFE_OF_ASSET", meaning = "An error means rework or delay on site or in the shop: drawings, specifications, datasheets." }),
            ("C", "Low", new { retention = "PROJECT_DURATION", meaning = "An error is put right with no consequence on site: lists, reports for information." }));
        Set(ValueSets.Confidentiality,
            ("PUBLIC", "Public", null), ("INTERNAL", "Internal", new { @default = true }),
            ("CONFIDENTIAL", "Confidential", null));

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
                // One line for any phase; a phase that names its revisions otherwise gets its own (Settings, Revisions).
                new()
                {
                    Code = "DESIGN", Label = "Any phase", Kind = SeriesKinds.Letters, Start = "A",
                    ExcludedLetters = ["I", "O", "Q", "S", "X", "Z"],
                },
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

        // IFU: work does not go ahead on it; it goes back to its author (or supplier) to update for the next revision.
        Set(ReviewSets.Statuses,
            ("IFI", "Issued for information", new { executes = false }),
            ("IFR", "Issued for review", new { executes = false }),
            ("IFA", "Issued for approval", new { executes = false }),
            ("IFU", "Issued for update", new { executes = false, update = true }),
            ("IFC", "Issued for construction", new { executes = true }),
            ("AFC", "Approved for construction", new { executes = true }));
        // Each verdict says one of the four meanings (accepted, with comments, rejected, for information); the names are ours.
        Set(ReviewSets.Verdicts,
            ("C1", "Accepted", new { proceed = true, resubmit = false, information = false }),
            ("C2", "Accepted with comments", new { proceed = true, resubmit = true, information = false }),
            ("C3", "Rejected: revise and resubmit", new { proceed = false, resubmit = true, information = false }),
            ("C4", "For information only", new { proceed = true, resubmit = false, information = true }));
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
                new() { Title = "Discipline check", FunctionCode = "ENG", Days = 5, Mode = StepModes.Any },
                new() { Title = "Approval", FunctionCode = "APP", Days = 3, Mode = StepModes.Any, GrantsStatuses = ["IFI", "IFR", "IFA", "IFU", "IFC", "AFC"] },
            ],
        });
        return true;
    }

    /// <summary>
    /// Issuing: why things are sent, transmittal numbers, a client that answers
    /// by proxy and a route that ends with their approval. Adds only what is missing.
    /// </summary>
    private async Task<bool> EnsureIssueSetupAsync(Guid t, CancellationToken cancellationToken, bool demo = true)
    {
        if (await db.ValueEntries.AnyAsync(v => v.SetKey == Transmittals.TransmittalSets.Reasons, cancellationToken)) return false;

        AddSet(t, Transmittals.TransmittalSets.Reasons,
        [
            // Each says its kind: data carries documents; information, a request or an answer.
            ("INFORMATION", "For information", new { response = false, family = "Data" }),
            ("REVIEW", "For review", new { response = true, responseDays = 10, family = "Data" }),
            ("APPROVAL", "For approval", new { response = true, responseDays = 10, family = "Data" }),
            ("PRICING", "For pricing", new { response = true, responseDays = 15, family = "Data" }),
            ("EXECUTION", "For execution", new { response = false, executes = true, family = "Data" }),
            ("RECORD", "For record", new { response = false, family = "Data" }),
            .. InformationReasons,
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
        if (demo) AddDemoClient(t);

        // Viewers are on the distribution: the matrix says who receives what.
        var viewer = await db.Functions.Include(f => f.Rules).SingleOrDefaultAsync(f => f.Code == "VIEW", cancellationToken);
        if (viewer?.Rules.FirstOrDefault() is { } rule && !rule.Verbs.Contains(Verbs.Receive))
        {
            rule.Verbs = [.. rule.Verbs, Verbs.Receive];
        }
        return true;
    }

    /// <summary>The demo's client, who answers by proxy, and the route that ends with their approval.</summary>
    private void AddDemoClient(Guid t)
    {
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
                new() { Title = "Discipline check", FunctionCode = "ENG", Days = 5, Mode = StepModes.Any },
                new() { Title = "Client approval", PartyCode = "NWU", Mode = StepModes.Any, Reason = "APPROVAL", Days = 10, GrantsStatuses = ["AFC"] },
            ],
        });
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
    /// Revision schemes have one line for any phase (the others name a phase). A scheme seeded with two lines and no
    /// phase keeps the first; a second no revision carries is dropped, one carried stays.
    /// </summary>
    private async Task<bool> EnsureRevisionLinesAsync(CancellationToken cancellationToken)
    {
        var changed = false;
        var carried = await db.Revisions.Select(r => r.Series).Distinct().ToListAsync(cancellationToken);
        foreach (var scheme in await db.RevisionSchemes.ToListAsync(cancellationToken))
        {
            var defaults = scheme.Series.Where(l => l.Phase is null).ToList();
            var drop = defaults.Skip(1).Where(l => !carried.Contains(l.Code)).ToList();
            if (drop.Count == 0) continue;
            scheme.Series = [.. scheme.Series.Except(drop)];
            if (scheme.Series.FirstOrDefault(l => l.Phase is null) is { Label: "Design" } line) line.Label = "Any phase";
            changed = true;
        }
        return changed;
    }

    /// <summary>Asset tags: P1001-TAG-0001, given by itself as a package number is. The recommendation, as data.</summary>
    private async Task<bool> EnsureAssetSetupAsync(Guid t, CancellationToken cancellationToken)
    {
        if (await db.SchemeRoutings.AnyAsync(r => r.DeliverableType == RecordKinds.Asset, cancellationToken)) return false;
        var scheme = new NumberingScheme
        {
            TenantId = t,
            Name = "Asset tags",
            Fields =
            [
                new() { Label = "Project code", Source = FieldSources.Project },
                new() { Label = "Record", Source = FieldSources.Fixed, Value = "TAG" },
                new() { Label = "Sequence", Source = FieldSources.Sequence, Digits = 4 },
            ],
        };
        db.NumberingSchemes.Add(scheme);
        db.SchemeRoutings.Add(new SchemeRouting { TenantId = t, DeliverableType = RecordKinds.Asset, SchemeId = scheme.Id });
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

    /// <summary>
    /// The document requirements list as a document type: reviewed like any deliverable, and read when released
    /// (see <see cref="Actions.RequirementsImporter"/>). Adds it when missing.
    /// </summary>
    private async Task<bool> EnsureRequirementsListTypeAsync(Guid t, CancellationToken cancellationToken)
    {
        if (await db.ValueEntries.AnyAsync(v => v.SetKey == ValueSets.DocumentTypes && v.Code == "RQL", cancellationToken)) return false;
        var sort = (await db.ValueEntries.Where(v => v.SetKey == ValueSets.DocumentTypes).MaxAsync(v => (int?)v.Sort, cancellationToken) ?? -1) + 1;
        db.ValueEntries.Add(new ValueEntry
        {
            TenantId = t,
            SetKey = ValueSets.DocumentTypes,
            Code = "RQL",
            Label = "Document requirements list",
            Sort = sort,
            Props = JsonSerializer.SerializeToDocument(new Dictionary<string, object> { [Actions.RequirementsImporter.Marker] = true }),
        });
        return true;
    }

    /// <summary>
    /// The project manager's disciplines-per-action list as a document type: reviewed like any deliverable, and read
    /// when released (see <see cref="Actions.DepartmentsImporter"/>). Adds it when missing.
    /// </summary>
    private async Task<bool> EnsureDepartmentsListTypeAsync(Guid t, CancellationToken cancellationToken)
    {
        if (await db.ValueEntries.AnyAsync(v => v.SetKey == ValueSets.DocumentTypes && v.Code == "DPA", cancellationToken)) return false;
        var sort = (await db.ValueEntries.Where(v => v.SetKey == ValueSets.DocumentTypes).MaxAsync(v => (int?)v.Sort, cancellationToken) ?? -1) + 1;
        db.ValueEntries.Add(new ValueEntry
        {
            TenantId = t,
            SetKey = ValueSets.DocumentTypes,
            Code = "DPA",
            Label = "Disciplines per action",
            Sort = sort,
            Props = JsonSerializer.SerializeToDocument(new Dictionary<string, object> { [Actions.DepartmentsImporter.Marker] = true }),
        });
        return true;
    }

    /// <summary>
    /// Correspondence: a deliverable type for what is filed rather than approved, numbered as our own engineering
    /// documents are, and its document types, released without a review. Adds only what is missing; an organization
    /// renames, retires or adds to any of it in its lists.
    /// </summary>
    private async Task<bool> EnsureCorrespondenceSetupAsync(Guid t, CancellationToken cancellationToken)
    {
        var added = await EnsureRequirementsListTypeAsync(t, cancellationToken);
        added |= await EnsureDepartmentsListTypeAsync(t, cancellationToken);
        if (await db.ValueEntries.AnyAsync(v => v.SetKey == ValueSets.DeliverableTypes && v.Code == "COR", cancellationToken)) return added;
        async Task<int> NextSortAsync(string set) =>
            (await db.ValueEntries.Where(v => v.SetKey == set).MaxAsync(v => (int?)v.Sort, cancellationToken) ?? -1) + 1;
        db.ValueEntries.Add(new ValueEntry
        {
            TenantId = t,
            SetKey = ValueSets.DeliverableTypes,
            Code = "COR",
            Label = "Correspondence",
            Sort = await NextSortAsync(ValueSets.DeliverableTypes),
        });
        // Numbered as our own engineering documents are.
        var scheme = await db.SchemeRoutings.Where(r => r.DeliverableType == "ENG").Select(r => (Guid?)r.SchemeId)
            .FirstOrDefaultAsync(cancellationToken);
        if (scheme is { } schemeId && !await db.SchemeRoutings.AnyAsync(r => r.DeliverableType == "COR", cancellationToken))
            db.SchemeRoutings.Add(new SchemeRouting { TenantId = t, DeliverableType = "COR", SchemeId = schemeId });
        var sort = await NextSortAsync(ValueSets.DocumentTypes);
        foreach (var (code, label) in new[]
        {
            ("MOM", "Minutes of meeting"),
            ("LET", "Letters and correspondence"),
            ("SRP", "Site and progress report"),
            ("PHO", "Site photos and survey records"),
            ("TCR", "Test certificate and inspection record"),
            ("DLN", "Delivery note, packing list, mill certificate"),
            ("PMT", "Permit and authority letter"),
            ("VCM", "Vendor catalogue and manual"),
            ("RFI", "Request for information"),
        })
        {
            if (await db.ValueEntries.AnyAsync(v => v.SetKey == ValueSets.DocumentTypes && v.Code == code, cancellationToken)) continue;
            db.ValueEntries.Add(new ValueEntry
            {
                TenantId = t,
                SetKey = ValueSets.DocumentTypes,
                Code = code,
                Label = label,
                Sort = sort++,
                Props = JsonSerializer.SerializeToDocument(new { review = false }),
            });
        }
        return true;
    }

    /// <summary>
    /// Schedules: a document type for the schedule itself, "for execution" made to
    /// mean a status that allows work, and the decisions taken about activities
    /// whose documents were missing. Adds only what is missing.
    /// </summary>
    private async Task<bool> EnsureScheduleSetupAsync(Guid t, CancellationToken cancellationToken)
    {
        var added = false;
        if (!await db.ValueEntries.AnyAsync(v => v.SetKey == ValueSets.DocumentTypes && v.Code == "SCH", cancellationToken))
        {
            var sort = await db.ValueEntries.Where(v => v.SetKey == ValueSets.DocumentTypes).MaxAsync(v => (int?)v.Sort, cancellationToken) ?? -1;
            db.ValueEntries.Add(new ValueEntry { TenantId = t, SetKey = ValueSets.DocumentTypes, Code = "SCH", Label = "Schedule", Sort = sort + 1 });
            var execution = await db.ValueEntries.SingleOrDefaultAsync(
                v => v.SetKey == Transmittals.TransmittalSets.Reasons && v.Code == "EXECUTION", cancellationToken);
            if (execution is not null) execution.Props = JsonSerializer.SerializeToDocument(new { response = false, executes = true });
            added = true;
        }
        if (!await db.ValueEntries.AnyAsync(v => v.SetKey == Actions.ScheduleSets.Decisions, cancellationToken))
        {
            AddSet(t, Actions.ScheduleSets.Decisions,
            [
                ("CARRIED", "Went ahead without them", new { proceeds = true }),
                ("STOPPED", "Stopped until they come", new { proceeds = false }),
            ]);
            added = true;
        }
        return added;
    }

    /// <summary>Why an information transmittal is sent: words alone, a request or an answer.</summary>
    private static readonly (string Code, string Label, object? Props)[] InformationReasons =
    [
        // A placeholder sent to a supplier carries it by itself: they fill it and send it back.
        ("IFU", "For update", new { response = true, responseDays = 10, family = "Data" }),
        ("REQUEST", "Request", new { response = true, responseDays = 7, family = "Information" }),
        ("RFI", "Request for information", new { response = true, responseDays = 7, family = "Information" }),
        ("ANSWER", "Answer", new { response = false, family = "Information" }),
        ("CONFIRMATION", "Confirmation", new { response = false, family = "Information" }),
    ];

    /// <summary>
    /// A setup made before transmittals had two kinds gains the reasons it lacks (the information ones, and IFU for
    /// placeholders); the reasons it has are
    /// not touched (one without a kind reads as data).
    /// </summary>
    private async Task<bool> EnsureInformationReasonsAsync(Guid t, CancellationToken cancellationToken)
    {
        var have = await db.ValueEntries.Where(v => v.SetKey == Transmittals.TransmittalSets.Reasons).Select(v => new { v.Code, v.Sort })
            .ToListAsync(cancellationToken);
        if (have.Count == 0) return false;
        var sort = have.Max(v => v.Sort) + 1;
        var added = false;
        // The reason IFU reads "For update", as the other reasons read "For review": it goes to them to update.
        foreach (var ifu in await db.ValueEntries.Where(v => v.SetKey == Transmittals.TransmittalSets.Reasons && v.Code == "IFU"
                && (v.Label == "Issued for use" || v.Label == "Issued for update"))
            .ToListAsync(cancellationToken))
        {
            ifu.Label = "For update";
            added = true;
        }
        // The status IFU reads as its siblings do (IFR "Issued for review"): "Issued for update". The reason stays plain.
        foreach (var status in await db.ValueEntries.Where(v => v.SetKey == ReviewSets.Statuses && v.Code == "IFU" && v.Label != "Issued for update")
            .ToListAsync(cancellationToken))
        {
            status.Label = "Issued for update";
            added = true;
        }
        // The reason IFU asks an answer (the supplier sends the documents back): it gives its period, 10 working days.
        foreach (var ifu in await db.ValueEntries.Where(v => v.SetKey == Transmittals.TransmittalSets.Reasons && v.Code == "IFU").ToListAsync(cancellationToken))
        {
            var props = ifu.Props?.RootElement;
            if (props is { ValueKind: JsonValueKind.Object } p && !p.TryGetProperty("responseDays", out _) && !p.TryGetProperty("responsePeriodDays", out _))
            {
                var copy = p.EnumerateObject().ToDictionary(x => x.Name, x => x.Value.Clone());
                copy["responseDays"] = JsonSerializer.SerializeToElement(10);
                ifu.Props = JsonSerializer.SerializeToDocument(copy);
                added = true;
            }
        }
        foreach (var (code, label, props) in InformationReasons)
        {
            if (have.Any(v => v.Code == code)) continue;
            db.ValueEntries.Add(new ValueEntry
            {
                TenantId = t,
                SetKey = Transmittals.TransmittalSets.Reasons,
                Code = code,
                Label = label,
                Sort = sort++,
                Props = props is null ? null : JsonSerializer.SerializeToDocument(props),
            });
            added = true;
        }
        return added;
    }

    /// <summary>
    /// Values saved by Settings before its property names matched the backend's: "executionFlag" is "executes" (a
    /// status lets work go ahead), "responsePeriodDays" is "responseDays" (a reason's answer period). Renamed in place.
    /// </summary>
    private async Task<bool> EnsurePropNamesAsync(CancellationToken cancellationToken)
    {
        var renames = new Dictionary<string, string> { ["executionFlag"] = "executes", ["responsePeriodDays"] = "responseDays" };
        var changed = false;
        foreach (var entry in await db.ValueEntries.Where(v => v.Props != null).ToListAsync(cancellationToken))
        {
            var props = entry.Props!.RootElement;
            if (props.ValueKind != JsonValueKind.Object || !renames.Keys.Any(k => props.TryGetProperty(k, out _))) continue;
            var copy = new Dictionary<string, JsonElement>();
            foreach (var p in props.EnumerateObject()) copy[renames.GetValueOrDefault(p.Name, p.Name)] = p.Value.Clone();
            entry.Props = JsonSerializer.SerializeToDocument(copy);
            changed = true;
        }
        return changed;
    }

    /// <summary>
    /// A setup made before "Issued for update" gains the status, after IFA; route steps that may grant IFR may grant it
    /// too. Nothing it has is changed.
    /// </summary>
    private async Task<bool> EnsureUpdateStatusAsync(Guid t, CancellationToken cancellationToken)
    {
        var have = await db.ValueEntries.Where(v => v.SetKey == ReviewSets.Statuses).ToListAsync(cancellationToken);
        if (have.Count == 0 || have.Any(v => v.Code == "IFU")) return false;
        var after = have.FirstOrDefault(v => v.Code == "IFA")?.Sort ?? have.Max(v => v.Sort);
        foreach (var later in have.Where(v => v.Sort > after)) later.Sort++;
        db.ValueEntries.Add(new ValueEntry
        {
            TenantId = t,
            SetKey = ReviewSets.Statuses,
            Code = "IFU",
            Label = "Issued for update",
            Sort = after + 1,
            Props = JsonSerializer.SerializeToDocument(new { executes = false, update = true }),
        });
        foreach (var step in (await db.ReviewRoutes.ToListAsync(cancellationToken)).SelectMany(r => r.Steps).Where(s => s.GrantsStatuses.Contains("IFR")))
            step.GrantsStatuses = [.. step.GrantsStatuses, "IFU"];
        return true;
    }

    /// <summary>Adds a published list of values (for example the disciplines) with each value's code, label, sort order and optional properties stored as JSON.</summary>
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
