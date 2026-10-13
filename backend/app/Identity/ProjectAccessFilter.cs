using Delios.Host.Platform;

namespace Delios.Host.Identity;

/// <summary>Loads the caller's access to the project in the route; 404 when they are not on it.</summary>
public sealed class ProjectAccessFilter(ProjectAccessLoader loader) : IEndpointFilter
{
    /// <summary>
    /// Key under which the loaded <c>ProjectAccess</c> is stored in <c>HttpContext.Items</c> for the rest of the request.
    /// </summary>
    private const string Key = "delios:project-access";

    /// <summary>
    /// Runs before the endpoint: reads <c>projectId</c> from the route, loads the caller's access to that project and stores it for the handler.
    /// Returns 404 instead of 403 when the caller is not on the project, so outsiders cannot tell which projects exist.
    /// </summary>
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

    /// <summary>
    /// Gets the project access this filter stored for the current request. Called from endpoint handlers; throws if the filter was not attached to the endpoint.
    /// </summary>
    public static ProjectAccess Of(HttpContext http) =>
        http.Items[Key] as ProjectAccess ?? throw new InvalidOperationException("ProjectAccessFilter did not run.");
}
