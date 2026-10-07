using Delios.Host.Platform;

namespace Delios.Host.Identity;

/// <summary>Loads the caller's access to the project in the route; 404 when they are not on it.</summary>
public sealed class ProjectAccessFilter(ProjectAccessLoader loader) : IEndpointFilter
{
    private const string Key = "delios:project-access";

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (!Guid.TryParse(http.GetRouteValue("projectId")?.ToString(), out var projectId))
        {
            return Problems.NotFound("PROJECT_NOT_FOUND", "No such project.");
        }
        var access = await loader.LoadAsync(projectId, http.User, http.RequestAborted);
        if (access is null) return Problems.NotFound("PROJECT_NOT_FOUND", "No such project.");
        http.Items[Key] = access;
        return await next(context);
    }

    public static ProjectAccess Of(HttpContext http) =>
        http.Items[Key] as ProjectAccess ?? throw new InvalidOperationException("ProjectAccessFilter did not run.");
}
