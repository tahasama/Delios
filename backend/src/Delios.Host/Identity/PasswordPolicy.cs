using System.Security.Cryptography;
using Delios.Host.Platform;
using Microsoft.Extensions.Options;

namespace Delios.Host.Identity;

/// <summary>Settings for new passwords, read from the "Passwords" section.</summary>
public sealed class NewPasswordOptions
{
    public const string Section = "Passwords";
    /// <summary>
    /// Refuse a password found in known data breaches (Have I Been Pwned). Only the first five characters of its SHA-1
    /// hash leave the server, never the password; if the service cannot be reached, the password is accepted.
    /// </summary>
    public bool CheckBreached { get; set; } = true;
}

/// <summary>
/// What a new password must be, wherever one is set (sign-up, an administrator, a reset, a first password): at least
/// 12 characters, and not one already published in a data breach. Passwords set before stay valid.
/// </summary>
public sealed class PasswordPolicy(IHttpClientFactory http, IOptions<NewPasswordOptions> options, ILogger<PasswordPolicy> logger)
{
    /// <summary>The shortest new password accepted.</summary>
    public const int MinLength = 8;
    public const string HttpClientName = "pwned-passwords";

    /// <summary>Why this password is refused, or null when it is accepted.</summary>
    public async Task<IResult?> RefusalAsync(string? password, CancellationToken cancellationToken)
    {
        if ((password ?? "").Length < MinLength)
            return Problems.Invalid("PASSWORD_TOO_SHORT", $"A password has at least {MinLength} characters.");
        if (options.Value.CheckBreached && await BreachedAsync(password!, cancellationToken))
            return Problems.Invalid("PASSWORD_BREACHED",
                "This password appears in published data breaches, so it is easy to guess. Choose another.");
        return null;
    }

    /// <summary>Asks the breach list by the hash's first five characters (k-anonymity) and looks for the rest locally.</summary>
    private async Task<bool> BreachedAsync(string password, CancellationToken cancellationToken)
    {
        var hash = Convert.ToHexString(SHA1.HashData(System.Text.Encoding.UTF8.GetBytes(password)));
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, $"https://api.pwnedpasswords.com/range/{hash[..5]}");
            request.Headers.Add("Add-Padding", "true");
            using var response = await http.CreateClient(HttpClientName).SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode) return false;
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            var suffix = hash[5..];
            foreach (var line in body.Split('\n'))
            {
                var parts = line.Trim().Split(':');
                if (parts.Length == 2 && parts[0].Equals(suffix, StringComparison.OrdinalIgnoreCase) && parts[1] != "0") return true;
            }
            return false;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning(e, "The breached-password list could not be reached; the password was accepted");
            return false;
        }
    }
}
