using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Actions;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Records;

public static partial class ProjectRecordEndpoints
{
    // ── Number ranges ──────────────────────────────────────────

    private static async Task<IResult> IssueRangeAsync(NumberRangeRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!await KeepsAsync(h, access)) return KeepersOnly("the number ranges");
        var prefix = r.Prefix?.Trim() ?? "";
        var to = Blank(r.IssuedTo);
        if (prefix.Length == 0 || to is null) return Problems.Invalid("FIELDS_REQUIRED", "Say which numbers (the fields they start with) and who gets them.");
        if (r.From < 0 || r.To < r.From) return Problems.Invalid("RANGE_INVALID", "A range runs from a number up to a number no smaller.");
        var overlap = await db.Set<NumberRange>().AnyAsync(x => x.ProjectId == access.Project.Id && x.Prefix == prefix && x.Status != "CLOSED"
            && x.From <= r.To && r.From <= x.To, c);
        if (overlap) return Problems.Conflict("RANGE_OVERLAPS", "Those numbers overlap a range already given out.");
        var row = new NumberRange
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            Prefix = prefix,
            From = r.From,
            To = r.To,
            LastIssued = r.From - 1,
            IssuedTo = to,
            IssuedByName = access.UserName,
            CreatedAt = clock.GetCurrentInstant(),
        };
        db.Add(row);
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "NUMBER_RANGE_ISSUED", "NumberRange", row.Id, $"{prefix} {r.From}–{r.To}", $"Given to {to}.", access.Project.Id, c);
        return Results.Ok(row);
    }
}
