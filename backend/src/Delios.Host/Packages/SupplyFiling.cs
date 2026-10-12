using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Reviews;
using Delios.Host.Tenancy;
using Delios.Host.Transmittals;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Packages;

/// <summary>
/// Every document another organization owes us is in that supplier's package, by supplier and purchase order. The
/// package is made by itself with the first such document; Document Control may then rename it, renumber it before it
/// is shared, and add what the rule missed. Nothing is asked of the supplier by being filed: asking is a transmittal.
/// </summary>
public sealed class SupplyFiling(DeliosDbContext db, Numbering numbering, AuditLog audit, IClock clock)
{
    /// <summary>Files a document just registered into its supplier's package, making the package when there is none. Saves.</summary>
    public async Task FileAsync(Project project, Document document, Actor actor, CancellationToken cancellationToken)
    {
        if (document.Kind == DocumentKinds.Record || document.Originator is not { } code) return;
        var supplier = await db.Parties.AsNoTracking().FirstOrDefaultAsync(p => p.Code == code && !p.IsInternal && p.Active, cancellationToken);
        if (supplier is null) return;
        var order = string.IsNullOrWhiteSpace(document.ContractRef) ? null : document.ContractRef.Trim();
        var package = await db.Packages.Include(p => p.Members)
            .Where(p => p.ProjectId == project.Id && p.Kind == PackageKinds.Supply && p.SupplierPartyId == supplier.Id
                && p.State == PackageStates.Open && p.PurchaseOrder == order)
            .OrderBy(p => p.CreatedAt).FirstOrDefaultAsync(cancellationToken);
        var now = clock.GetCurrentInstant();
        if (package is null)
        {
            var catalog = await Catalog.LoadAsync(db, cancellationToken);
            // What a supplier is asked for: approval where the organization publishes it; needed at a status that lets
            // work go ahead. Document Control changes either on the package.
            var reasons = catalog.Active(TransmittalSets.Reasons);
            var reason = reasons.FirstOrDefault(r => r.Code.Contains("APPROV", StringComparison.OrdinalIgnoreCase)).Code
                ?? reasons.Select(r => r.Code).FirstOrDefault(c => catalog.Prop(TransmittalSets.Reasons, c, "response") is { ValueKind: System.Text.Json.JsonValueKind.True })
                ?? reasons.FirstOrDefault().Code;
            var statuses = catalog.Active(ReviewSets.Statuses);
            var status = statuses.Select(s => s.Code).FirstOrDefault(c => catalog.Prop(ReviewSets.Statuses, c, "executes") is { ValueKind: System.Text.Json.JsonValueKind.True })
                ?? statuses.FirstOrDefault().Code;
            if (reason is null || status is null) return;
            package = new Package
            {
                TenantId = project.TenantId,
                ProjectId = project.Id,
                Number = await numbering.RecordAsync(project.TenantId, project.Id, RecordKinds.Package,
                    NumberFields.ForRecord(project.Code), "PK", cancellationToken),
                Kind = PackageKinds.Supply,
                SupplierPartyId = supplier.Id,
                PurchaseOrder = order,
                Title = order is null ? supplier.Name : $"{supplier.Name} — {order}",
                Reason = reason,
                RequiredStatuses = [status],
                Rule = new PackageRule { Originators = [supplier.Code] },
                AutoCreated = true,
                CreatedById = actor.Id ?? Guid.Empty,
                CreatedByName = actor.Name,
                CreatedAt = now,
            };
            db.Packages.Add(package);
            await audit.WriteAsync(actor, "PACKAGE_CREATED", "Package", package.Id, package.Number,
                $"{package.Title}: made by itself for what {supplier.Name} owes{(order is null ? "" : $" under {order}")}.", project.Id, cancellationToken);
        }
        if (package.Members.All(m => m.DocumentId != document.Id) && !package.Excluded.Contains(document.Id))
        {
            package.Members.Add(new PackageMember
            {
                TenantId = package.TenantId,
                PackageId = package.Id,
                DocumentId = document.Id,
                ByRule = true,
                AddedAt = now,
            });
        }
        await db.SaveChangesAsync(cancellationToken);
    }
}
