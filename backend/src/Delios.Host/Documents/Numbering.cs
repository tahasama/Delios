using System.Globalization;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Documents;

public sealed record NumberFields(
    string ProjectCode, string? Subproject, string? Originator, string? ContractRef, string Discipline, string DocType);

public abstract record Allocation
{
    public sealed record Allocated(string Number) : Allocation;
    public sealed record NoScheme(string DeliverableType) : Allocation;
    public sealed record MissingField(string Label) : Allocation;
}

/// <summary>
/// Document numbers are built by the system from the scheme routed to the
/// deliverable type, never typed. The sequence restarts for each distinct prefix.
/// </summary>
public sealed class Numbering(DeliosDbContext db)
{
    public async Task<Allocation> AllocateAsync(
        Guid tenantId, Guid projectId, string deliverableType, NumberFields fields, CancellationToken cancellationToken)
    {
        var scheme = await db.SchemeRoutings.AsNoTracking()
            .Where(r => r.DeliverableType == deliverableType && r.Active && r.Scheme!.Active)
            .Select(r => r.Scheme)
            .SingleOrDefaultAsync(cancellationToken);
        if (scheme is null) return new Allocation.NoScheme(deliverableType);

        var parts = new List<string>();
        foreach (var field in scheme.Fields.Where(f => f.Source != FieldSources.Sequence))
        {
            var value = field.Source switch
            {
                FieldSources.Project => fields.ProjectCode,
                FieldSources.Subproject => fields.Subproject,
                FieldSources.Originator => fields.Originator,
                FieldSources.ContractRef => fields.ContractRef,
                FieldSources.Discipline => fields.Discipline,
                FieldSources.DocType => fields.DocType,
                _ => null,
            };
            if (string.IsNullOrEmpty(value)) return new Allocation.MissingField(field.Label);
            parts.Add(value);
        }

        var prefix = string.Join(scheme.Delimiter, parts);
        var digits = scheme.Fields.Single(f => f.Source == FieldSources.Sequence).Digits ?? 5;
        // One statement: two people registering at the same moment get different numbers.
        var sequence = await db.Database.SqlQuery<int>($"""
            INSERT INTO number_counters (tenant_id, project_id, prefix, next)
            VALUES ({tenantId}, {projectId}, {prefix}, 2)
            ON CONFLICT (project_id, prefix) DO UPDATE SET next = number_counters.next + 1
            RETURNING next - 1 AS "Value"
            """).ToListAsync(cancellationToken);

        return new Allocation.Allocated(
            prefix + scheme.Delimiter + sequence[0].ToString(CultureInfo.InvariantCulture).PadLeft(digits, '0'));
    }
}
