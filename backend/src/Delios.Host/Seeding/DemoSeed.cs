using System.Text.Json;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Seeding;

/// <summary>
/// A demo tenant to try the system with: people in each function on one project.
/// Every password is <c>demo1234</c>. Development only.
/// </summary>
public sealed class DemoSeed(DeliosDbContext db, TenantSetup setup, ILogger<DemoSeed> logger)
{
    public const string Slug = "demo";
    public const string Password = "demo1234";

    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        if (await db.Tenants.AnyAsync(t => t.Slug == Slug, cancellationToken))
        {
            logger.LogInformation("The demo tenant already exists; nothing to do");
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
        var viewer = Fn("VIEW", "Viewer", Verbs.Read);
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
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        logger.LogInformation("Demo tenant '{Slug}' created; every password is {Password}", Slug, Password);
    }

    /// <summary>The published lists and numbering a project needs before its first document.</summary>
    private void AddConfiguration(Guid t)
    {
        void Set(string key, params (string Code, string Label, object? Props)[] values)
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
            ("A", "High", new { retention = "PERMANENT" }), ("B", "Medium", new { retention = "LIFE_OF_ASSET" }), ("C", "Low", null));
        Set(ValueSets.Confidentiality,
            ("PUBLIC", "Public", null), ("INTERNAL", "Internal", new { @default = true }),
            ("CONFIDENTIAL", "Confidential", new { restricted = true }));

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
}
