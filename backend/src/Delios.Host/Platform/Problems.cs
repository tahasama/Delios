namespace Delios.Host.Platform;

/// <summary>
/// Errors carry a stable <c>code</c> the frontend translates, and the values to put
/// in the sentence. The English title is for logs and API users.
/// </summary>
public static class Problems
{
    public static IResult Invalid(string code, string message, object? parameters = null) =>
        Problem(StatusCodes.Status422UnprocessableEntity, code, message, parameters);

    public static IResult Forbidden(string code, string message, object? parameters = null) =>
        Problem(StatusCodes.Status403Forbidden, code, message, parameters);

    public static IResult NotFound(string code, string message) =>
        Problem(StatusCodes.Status404NotFound, code, message, null);

    public static IResult Conflict(string code, string message, object? parameters = null) =>
        Problem(StatusCodes.Status409Conflict, code, message, parameters);

    public static IResult Problem(int status, string code, string message, object? parameters) =>
        Results.Problem(statusCode: status, title: message, extensions: new Dictionary<string, object?>
        {
            ["code"] = code,
            ["params"] = parameters,
        });
}
