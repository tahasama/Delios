using System.Security.Cryptography;

namespace Delios.Host.Identity;

/// <summary>
/// Time-based one-time codes (RFC 6238): what Microsoft Authenticator, Google
/// Authenticator and the like show. Six digits, 30 seconds, SHA-1, as they all expect.
/// </summary>
public static class Totp
{
    /// <summary>Number of digits in a code.</summary>
    public const int Digits = 6;
    /// <summary>How long one code is valid, in seconds (one "step").</summary>
    public const int StepSeconds = 30;
    /// <summary>The Base32 alphabet (RFC 4648) that authenticator apps use for secrets.</summary>
    private const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    /// <summary>Makes a new random 20-byte (160-bit) secret, the size authenticator apps expect for SHA-1.</summary>
    public static byte[] NewSecret() => RandomNumberGenerator.GetBytes(20);

    /// <summary>Returns the step number for a moment: seconds since 1970 divided by <c>StepSeconds</c>.</summary>
    public static long StepAt(DateTimeOffset time) => time.ToUnixTimeSeconds() / StepSeconds;

    /// <summary>
    /// Computes the six-digit code for a secret and step, as defined by HOTP (RFC 4226): an HMAC-SHA-1 of the step number, cut down to six digits.
    /// </summary>
    public static string Code(byte[] secret, long step)
    {
        Span<byte> counter = stackalloc byte[8];
        System.Buffers.Binary.BinaryPrimitives.WriteInt64BigEndian(counter, step);
        var hash = HMACSHA1.HashData(secret, counter);
        var offset = hash[^1] & 0x0f;
        var value = ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
        return (value % 1_000_000).ToString("D6", System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// The step the code belongs to, allowing one step of clock drift either way,
    /// or null. A step at or before the last one accepted is refused: a code works once.
    /// </summary>
    public static long? Verify(byte[] secret, string? code, DateTimeOffset now, long? lastStep)
    {
        var digits = new string((code ?? "").Where(char.IsDigit).ToArray());
        if (digits.Length != Digits) return null;
        var current = StepAt(now);
        for (var step = current - 1; step <= current + 1; step++)
        {
            if (step <= (lastStep ?? long.MinValue)) continue;
            if (CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.ASCII.GetBytes(Code(secret, step)), System.Text.Encoding.ASCII.GetBytes(digits)))
            {
                return step;
            }
        }
        return null;
    }

    /// <summary>Encodes bytes as Base32 text without padding, the form a person types into an authenticator app.</summary>
    public static string Base32(byte[] data)
    {
        var output = new System.Text.StringBuilder();
        int buffer = 0, bits = 0;
        foreach (var b in data)
        {
            buffer = (buffer << 8) | b;
            bits += 8;
            while (bits >= 5)
            {
                output.Append(Alphabet[(buffer >> (bits - 5)) & 31]);
                bits -= 5;
            }
        }
        if (bits > 0) output.Append(Alphabet[(buffer << (5 - bits)) & 31]);
        return output.ToString();
    }

    /// <summary>
    /// Decodes Base32 text back to bytes, ignoring spaces, padding and letter case. Throws <c>FormatException</c> on any other character.
    /// </summary>
    public static byte[] FromBase32(string text)
    {
        var bytes = new List<byte>();
        int buffer = 0, bits = 0;
        foreach (var c in text.ToUpperInvariant().Where(c => c != '=' && c != ' '))
        {
            var value = Alphabet.IndexOf(c);
            if (value < 0) throw new FormatException("Not base32.");
            buffer = (buffer << 5) | value;
            bits += 5;
            if (bits >= 8)
            {
                bytes.Add((byte)((buffer >> (bits - 8)) & 0xff));
                bits -= 8;
            }
        }
        return [.. bytes];
    }

    /// <summary>What an authenticator app scans.</summary>
    public static string Uri(string issuer, string account, byte[] secret) =>
        $"otpauth://totp/{System.Uri.EscapeDataString(issuer)}:{System.Uri.EscapeDataString(account)}"
        + $"?secret={Base32(secret)}&issuer={System.Uri.EscapeDataString(issuer)}&digits={Digits}&period={StepSeconds}";
}
