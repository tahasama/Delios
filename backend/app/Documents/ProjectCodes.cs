using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Documents;

/// <summary>
/// A project's code is in the Settings list of project codes the moment the
/// project exists, so a document is never refused for it: in the organization's
/// lists and in every project's own copy. Called when a project is created or its
/// code changes, and before a document is numbered (which covers projects made
/// before this rule). A value an administrator retired is left as they set it.
/// </summary>
public static class ProjectCodes
{
    public static async Task EnsurePublishedAsync(DeliosDbContext db, Guid tenantId, string code, string name, CancellationToken cancellationToken)
    {
        var owners = await db.Projects.AsNoTracking().Where(p => p.TenantId == tenantId && p.OwnLists).Select(p => (Guid?)p.Id).ToListAsync(cancellationToken);
        foreach (var projectId in owners.Prepend(null))
        {
            var known = db.ValueEntries.Local.Any(v => v.TenantId == tenantId && v.ProjectId == projectId && v.SetKey == ValueSets.ProjectCodes && v.Code == code)
                || await db.ValueEntries.IgnoreQueryFilters().AnyAsync(v => v.TenantId == tenantId && v.ProjectId == projectId
                    && v.SetKey == ValueSets.ProjectCodes && v.Code == code, cancellationToken);
            if (known) continue;
            var sort = await db.ValueEntries.IgnoreQueryFilters().Where(v => v.TenantId == tenantId && v.ProjectId == projectId && v.SetKey == ValueSets.ProjectCodes)
                .Select(v => (int?)v.Sort).MaxAsync(cancellationToken) ?? 0;
            db.ValueEntries.Add(new ValueEntry { TenantId = tenantId, ProjectId = projectId, SetKey = ValueSets.ProjectCodes, Code = code, Label = name, Sort = sort + 1 });
        }
    }
}
