using Delios.Host.Platform;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Documents;

/// <summary>
/// A project's code is in the Settings list of project codes the moment the
/// project exists, so a document is never refused for it. Called when a project
/// is created or its code changes, and before a document is numbered (which
/// covers projects made before this rule). A value an administrator retired is
/// left as they set it.
/// </summary>
public static class ProjectCodes
{
    public static async Task EnsurePublishedAsync(DeliosDbContext db, Guid tenantId, string code, string name, CancellationToken cancellationToken)
    {
        var known = db.ValueEntries.Local.Any(v => v.TenantId == tenantId && v.SetKey == ValueSets.ProjectCodes && v.Code == code)
            || await db.ValueEntries.AnyAsync(v => v.TenantId == tenantId && v.SetKey == ValueSets.ProjectCodes && v.Code == code, cancellationToken);
        if (known) return;
        var sort = await db.ValueEntries.Where(v => v.TenantId == tenantId && v.SetKey == ValueSets.ProjectCodes)
            .Select(v => (int?)v.Sort).MaxAsync(cancellationToken) ?? 0;
        db.ValueEntries.Add(new ValueEntry { TenantId = tenantId, SetKey = ValueSets.ProjectCodes, Code = code, Label = name, Sort = sort + 1 });
    }
}
