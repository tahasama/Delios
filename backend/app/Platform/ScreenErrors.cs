namespace Delios.Host.Platform;

/// <summary>
/// What failed on the screens, in the browser or on the screens' own server (owner, "error tracking"): written in the
/// backend's log as an error, which Serilog passes on to Sentry where a Sentry address is set (<c>Sentry__Dsn</c>). One
/// place that collects every fault, ours and the screens'. Who it happened to is the account's id only, never a name or
/// an email; nothing of a document is sent. Open to the signed-out pages too (a sign-in page can fail), and counted
/// tightly per caller (<c>screen-errors</c>): a page cannot fill the log.
/// </summary>
public static class ScreenErrors
{
    public sealed record Report(string? Where, string? Message, string? Digest, string? Stack, string? Page);

    public static void MapScreenErrorEndpoints(this IEndpointRouteBuilder app) =>
        app.MapPost("/api/screens/errors", (Report report, HttpContext http, ILoggerFactory loggers) =>
        {
            var logger = loggers.CreateLogger("Delios.Screens");
            var signedIn = http.User.Identity?.IsAuthenticated == true;
            logger.LogError("Screens failed ({Where}) on {Page}: {Message} [digest {Digest}, user {UserId}, organization {TenantId}]\n{Stack}",
                Cut(report.Where, 20) ?? "browser", Cut(report.Page, 300) ?? "?", Cut(report.Message, 1000) ?? "(no message)",
                Cut(report.Digest, 100) ?? "-", signedIn ? http.User.UserId() : null, signedIn ? http.User.TenantId() : null,
                Cut(report.Stack, 8000) ?? "");
            return Results.NoContent();
        }).AllowAnonymous().RequireRateLimiting("screen-errors").WithTags("Screens");

    private static string? Cut(string? text, int most) =>
        string.IsNullOrWhiteSpace(text) ? null : text.Length <= most ? text : text[..most] + "…";
}
