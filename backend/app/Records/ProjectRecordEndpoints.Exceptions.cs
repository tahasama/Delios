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
    // ── Exceptions and number ranges ──────────────────────────────────────────

    private static async Task<IResult> AddExceptionAsync(ExceptionRequest r, HttpContext h, DeliosDbContext db, AuditLog audit, IClock clock, CancellationToken c)
    {
        var access = ProjectAccessFilter.Of(h);
        if (!await KeepsAsync(h, access)) return KeepersOnly("the published exceptions");
        if (Blank(r.Item) is not { } item || Blank(r.Clauses) is not { } clauses || Blank(r.Reason) is not { } reason
            || Blank(r.Authority) is not { } authority || r.StartDate is not { } start)
            return Problems.Invalid("FIELDS_REQUIRED", "An exception says what, which clauses, why, on whose authority, and from when.");
        if (r.ReviewPoint is { } review && review < start) return Problems.Invalid("REVIEW_BEFORE_START", "It is reviewed after it starts, not before.");
        var row = new ExceptionEntry
        {
            TenantId = access.Project.TenantId,
            ProjectId = access.Project.Id,
            Item = item,
            Clauses = clauses,
            Reason = reason,
            Authority = authority,
            StartDate = LocalDate.FromDateOnly(start),
            ReviewPoint = r.ReviewPoint is { } rp ? LocalDate.FromDateOnly(rp) : null,
            RecordedByName = access.UserName,
            CreatedAt = clock.GetCurrentInstant(),
        };
        db.Add(row);
        await db.SaveChangesAsync(c);
        await audit.WriteAsync(Who(access), "EXCEPTION_RECORDED", "Exception", row.Id, item, $"Clauses {clauses}, on the authority of {authority}: {reason}",
            access.Project.Id, c);
        return Results.Ok(row);
    }

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
