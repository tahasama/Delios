using System.Text.Json;
using Delios.Host.Platform;
using Microsoft.Extensions.Options;

namespace Delios.Host.Identity;

/// <summary>Cloudflare Turnstile settings, read from the "Turnstile" section. No secret key: the check is off.</summary>
public sealed class TurnstileOptions
{
    public const string Section = "Turnstile";
    public string? SecretKey { get; set; }
}

/// <summary>
/// The check that a person, not a script, is behind a sign-in, a sign-up, a forgotten password or a resent link
/// (Cloudflare Turnstile). The page shows the widget; its token is checked here once. If Cloudflare cannot be
/// reached, the request goes through: the sign-in limits still hold, and nobody is locked out by an outage.
/// </summary>
public sealed class BotCheck(IHttpClientFactory http, IOptions<TurnstileOptions> options, ILogger<BotCheck> logger)
{
    public const string HttpClientName = "turnstile";

    /// <summary>The refusal when the check is on and the token does not pass; null otherwise.</summary>
    public async Task<IResult?> RefusalAsync(string? token, HttpContext context, CancellationToken cancellationToken)
    {
        var secret = options.Value.SecretKey;
        if (string.IsNullOrWhiteSpace(secret)) return null;
        var refused = Problems.Invalid("BOT_CHECK_FAILED", "The check that you are a person did not pass. Try again.");
        if (string.IsNullOrWhiteSpace(token)) return refused;
        try
        {
            var form = new Dictionary<string, string> { ["secret"] = secret, ["response"] = token };
            if (context.Connection.RemoteIpAddress?.ToString() is { } ip) form["remoteip"] = ip;
            using var response = await http.CreateClient(HttpClientName).PostAsync(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify", new FormUrlEncodedContent(form), cancellationToken);
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            return body.RootElement.TryGetProperty("success", out var success) && success.GetBoolean() ? null : refused;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException)
        {
            logger.LogWarning(e, "The bot check could not be reached; the request went through");
            return null;
        }
    }
}
