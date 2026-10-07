namespace Delios.Host.Platform;

/// <summary>
/// Errors carry a stable <c>code</c> the frontend translates, and the values to put
/// in the sentence. The English title is for logs and API users.
/// </summary>
public static class Problems
{
    /// <summary>
    /// 422 Unprocessable Entity: the request is well formed but its content is not acceptable (a missing or wrong field).
    /// </summary>
    public static IResult Invalid(string code, string message, object? parameters = null) =>
        Problem(StatusCodes.Status422UnprocessableEntity, code, message, parameters);

    /// <summary>403 Forbidden: the caller is signed in but is not allowed to do this.</summary>
    public static IResult Forbidden(string code, string message, object? parameters = null) =>
        Problem(StatusCodes.Status403Forbidden, code, message, parameters);

    /// <summary>404 Not Found: no such thing, or the caller may not know it exists.</summary>
    public static IResult NotFound(string code, string message) =>
        Problem(StatusCodes.Status404NotFound, code, message, null);

    /// <summary>
    /// 409 Conflict: the request clashes with the current state (for example something already exists or is already on).
    /// </summary>
    public static IResult Conflict(string code, string message, object? parameters = null) =>
        Problem(StatusCodes.Status409Conflict, code, message, parameters);

    /// <summary>
    /// Builds an RFC 7807 "problem details" JSON answer with the given status, the English message as <c>title</c>,
    /// and the stable <c>code</c> and optional <c>params</c> as extra fields. Used by all the helpers above and by endpoints needing other statuses.
    /// </summary>
    public static IResult Problem(int status, string code, string message, object? parameters) =>
        Results.Problem(statusCode: status, title: message, extensions: new Dictionary<string, object?>
        {
            ["code"] = code,
            ["params"] = parameters,
        });
}
