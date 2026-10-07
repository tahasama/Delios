using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using NodaTime;

namespace Delios.Host.Identity;

/// <summary>
/// Two-step sign-in: a password, then a code from an authenticator app. The
/// secret is encrypted with the application's keys; ten one-time recovery codes,
/// stored hashed, stand in for a lost phone.
/// </summary>
public sealed class Mfa(IDataProtectionProvider protection, IClock clock)
{
    public const int RecoveryCodes = 10;
    private static readonly TimeSpan ChallengeLifetime = TimeSpan.FromMinutes(5);

    private IDataProtector Secrets => protection.CreateProtector("delios.mfa.secret");
    private ITimeLimitedDataProtector Challenges => protection.CreateProtector("delios.mfa.challenge").ToTimeLimitedDataProtector();

    /// <summary>Proof that the password was right, good for five minutes, carried to the code step.</summary>
    public string Challenge(User user) => Challenges.Protect($"{user.TenantId:N}|{user.Id:N}", ChallengeLifetime);

    public (Guid TenantId, Guid UserId)? ReadChallenge(string? challenge)
    {
        if (string.IsNullOrEmpty(challenge)) return null;
        try
        {
            var parts = Challenges.Unprotect(challenge).Split('|');
            return (Guid.Parse(parts[0]), Guid.Parse(parts[1]));
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    /// <summary>A new secret, not in force until a code from it is confirmed.</summary>
    public (string Secret, string Uri) Enrol(User user, string issuer)
    {
        var secret = Totp.NewSecret();
        user.MfaSecretProtected = Secrets.Protect(Convert.ToBase64String(secret));
        user.MfaEnabledAt = null;
        user.MfaLastStep = null;
        return (Totp.Base32(secret), Totp.Uri(issuer, user.Email, secret));
    }

    /// <summary>Puts the enrolled secret in force once a code from it is right; returns the recovery codes, shown once.</summary>
    public IReadOnlyList<string>? Confirm(User user, string? code)
    {
        if (user.MfaSecretProtected is null || user.MfaEnabledAt is not null) return null;
        var step = Totp.Verify(SecretOf(user), code, Now, user.MfaLastStep);
        if (step is null) return null;
        user.MfaLastStep = step;
        user.MfaEnabledAt = clock.GetCurrentInstant();
        var codes = Enumerable.Range(0, RecoveryCodes)
            .Select(_ => Totp.Base32(RandomNumberGenerator.GetBytes(5)).ToLowerInvariant()).ToList();
        user.RecoveryCodeHashes = codes.Select(HashCode).ToArray();
        return codes.Select(c => $"{c[..4]}-{c[4..]}").ToList();
    }

    /// <summary>A code from the app, or one of the recovery codes, which is then spent.</summary>
    public bool Verify(User user, string? code)
    {
        if (user.MfaEnabledAt is null || user.MfaSecretProtected is null) return false;
        if (Totp.Verify(SecretOf(user), code, Now, user.MfaLastStep) is { } step)
        {
            user.MfaLastStep = step;
            return true;
        }
        var hash = HashCode(code ?? "");
        if (!user.RecoveryCodeHashes.Contains(hash)) return false;
        user.RecoveryCodeHashes = user.RecoveryCodeHashes.Where(h => h != hash).ToArray();
        return true;
    }

    public static void Disable(User user)
    {
        user.MfaSecretProtected = null;
        user.MfaEnabledAt = null;
        user.MfaLastStep = null;
        user.RecoveryCodeHashes = [];
    }

    private byte[] SecretOf(User user) => Convert.FromBase64String(Secrets.Unprotect(user.MfaSecretProtected!));
    private DateTimeOffset Now => clock.GetCurrentInstant().ToDateTimeOffset();

    private static string HashCode(string code) =>
        Convert.ToHexStringLower(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(
            new string(code.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant())));
}
