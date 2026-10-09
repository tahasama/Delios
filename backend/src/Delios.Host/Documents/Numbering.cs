using System.Globalization;
using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Documents;

/// <summary>
/// The facts a document number can be built from. Which of them are used, and in which order,
/// is set by the numbering scheme routed to the deliverable type.
/// </summary>
public sealed record NumberFields(
    string ProjectCode, string? Subproject, string? Originator, string? ContractRef, string? Discipline, string? DocType,
    string? Sender = null, string? Receiver = null)
{
    /// <summary>For records that are not documents: the project, fixed fields, and who sends to whom.</summary>
    public static NumberFields ForRecord(string projectCode, string? sender = null, string? receiver = null) =>
        new(projectCode, null, null, null, null, null, sender, receiver);
}

/// <summary>The outcome of <see cref="Numbering.AllocateAsync"/>: a number, or the reason none could be built.</summary>
public abstract record Allocation
{
    /// <summary>The number was built and its sequence reserved.</summary>
    public sealed record Allocated(string Number) : Allocation;
    /// <summary>No active numbering scheme is routed to this deliverable type.</summary>
    public sealed record NoScheme(string DeliverableType) : Allocation;
    /// <summary>The scheme needs a field that was left empty; <c>Label</c> names it.</summary>
    public sealed record MissingField(string Label) : Allocation;
}

/// <summary>
/// Document numbers are built by the system from the scheme routed to the
/// deliverable type, never typed. The sequence restarts for each distinct prefix.
/// </summary>
public sealed class Numbering(DeliosDbContext db)
{
    /// <summary>
    /// Builds the next number for a new document from the scheme routed to its deliverable type, and reserves it.
    /// Called by <see cref="DocumentService.RegisterAsync"/> and, for other records, by <see cref="RecordAsync"/>.
    /// </summary>
    /// <param name="deliverableType">The deliverable type, or a <see cref="RecordKinds"/> value.</param>
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
                FieldSources.Fixed => field.Value,
                FieldSources.Sender => fields.Sender,
                FieldSources.Receiver => fields.Receiver,
                _ => null,
            };
            if (string.IsNullOrEmpty(value)) return new Allocation.MissingField(field.Label);
            parts.Add(value);
        }

        var prefix = string.Join(scheme.Delimiter, parts);
        var digits = scheme.Fields.Single(f => f.Source == FieldSources.Sequence).Digits ?? 5;
        // A range issued to a named party for this prefix is drawn down first; a number already on a document is passed over.
        for (var tries = 0; tries < 100; tries++)
        {
            var number = await FromRangeAsync(projectId, prefix, scheme.Delimiter, digits, cancellationToken)
                ?? await NextAsync(tenantId, projectId, prefix, scheme.Delimiter, digits, cancellationToken);
            if (!await db.Documents.AnyAsync(d => d.ProjectId == projectId && d.Number == number, cancellationToken))
                return new Allocation.Allocated(number);
        }
        return new Allocation.Allocated(await NextAsync(tenantId, projectId, prefix, scheme.Delimiter, digits, cancellationToken));
    }

    /// <summary>
    /// The next number of an open range issued for this prefix, the lowest range first, or null when none is left.
    /// The range is marked exhausted when its last number is taken.
    /// </summary>
    private async Task<string?> FromRangeAsync(Guid projectId, string prefix, string delimiter, int digits, CancellationToken cancellationToken)
    {
        // One statement, the row locked: two people registering at once never draw the same number.
        var drawn = await db.Database.SqlQuery<int>($"""
            UPDATE number_ranges r
            SET last_issued = GREATEST(r.last_issued + 1, r."from"),
                status = CASE WHEN GREATEST(r.last_issued + 1, r."from") >= r."to" THEN 'EXHAUSTED' ELSE 'OPEN' END
            WHERE r.id = (
                SELECT id FROM number_ranges
                WHERE project_id = {projectId} AND prefix = {prefix} AND status = 'OPEN' AND GREATEST(last_issued + 1, "from") <= "to"
                ORDER BY "from" LIMIT 1 FOR UPDATE)
            RETURNING r.last_issued AS "Value"
            """).ToListAsync(cancellationToken);
        return drawn.Count == 0 ? null : prefix + delimiter + drawn[0].ToString(CultureInfo.InvariantCulture).PadLeft(digits, '0');
    }

    /// <summary>
    /// A record's number: from its scheme where the organization set one up, else
    /// the project code, a short marker and a sequence (P1001-TR-0001). Either way
    /// it comes from the same counter, so two at once never get the same one.
    /// </summary>
    public async Task<string> RecordAsync(
        Guid tenantId, Guid projectId, string recordKind, NumberFields fields, string marker, CancellationToken cancellationToken) =>
        await AllocateAsync(tenantId, projectId, recordKind, fields, cancellationToken) is Allocation.Allocated(var number)
            ? number
            : await NextAsync(tenantId, projectId, $"{fields.ProjectCode}-{marker}", "-", 4, cancellationToken);

    /// <summary>
    /// Takes the next sequence value for a prefix from the <c>number_counters</c> table and formats the full number,
    /// zero-padded to <paramref name="digits"/>. The counter is created on first use.
    /// </summary>
    private async Task<string> NextAsync(
        Guid tenantId, Guid projectId, string prefix, string delimiter, int digits, CancellationToken cancellationToken)
    {
        // One statement: two people registering at the same moment get different numbers.
        var sequence = await db.Database.SqlQuery<int>($"""
            INSERT INTO number_counters (tenant_id, project_id, prefix, next)
            VALUES ({tenantId}, {projectId}, {prefix}, 2)
            ON CONFLICT (project_id, prefix) DO UPDATE SET next = number_counters.next + 1
            RETURNING next - 1 AS "Value"
            """).ToListAsync(cancellationToken);
        return prefix + delimiter + sequence[0].ToString(CultureInfo.InvariantCulture).PadLeft(digits, '0');
    }
}
