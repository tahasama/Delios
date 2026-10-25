using Delios.Host.Platform;
using Delios.Host.Tenancy;

namespace Delios.Host.Packages;

/// <summary>
/// A document or a package of these projects changed in what a package reads (<see cref="Platform.ScreenChangeWatcher"/>):
/// the packages are brought up to date once, after the save (owner: "only when a document or package actually changes,
/// not when the list opens").
/// </summary>
public sealed record PackagesMoved(Guid TenantId, Guid[] Projects)
{
    public const string RoutingKey = "packages.moved";

    /// <summary>In the worker: every open package of these projects with a rule or a tree under it, brought up to date.</summary>
    public static async Task OnMovedAsync(IServiceProvider services, PackagesMoved message, CancellationToken cancellationToken)
    {
        services.GetRequiredService<TenantContext>().Set(message.TenantId);
        var db = services.GetRequiredService<DeliosDbContext>();
        await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
        await services.GetRequiredService<PackageService>().RestateAsync(message.Projects, cancellationToken);
        await tx.CommitAsync(cancellationToken);
    }
}
