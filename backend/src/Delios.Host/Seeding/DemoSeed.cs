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

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        logger.LogInformation("Demo tenant '{Slug}' created; every password is {Password}", Slug, Password);
    }
}
