using System.Buffers.Binary;
using System.Security.Cryptography;

namespace Delios.Host.Documents;

/// <summary>
/// Files are kept encrypted (owner, security review: "those files should be PROTECTED"): whoever gets the disk, the
/// store or its copies reads nothing without the key, which lives apart from them (<c>Storage:EncryptionKey</c>, FILES_KEY
/// in .env). Each file has its own key, kept in its header under the installation's key (AES-256-GCM), and its bytes are
/// sealed in pieces of 64 KiB, each checked when read, the last one marked: nothing can be changed, reordered or cut off
/// unnoticed. A copy inside the store stays readable (its key travels with it). Files kept before stay as they were and
/// are read as such (no header).
/// </summary>
public sealed class FileCipher
{
    /// <summary>"DLSE": the first bytes of an encrypted file.</summary>
    private static readonly byte[] Magic = "DLSE"u8.ToArray();
    private const byte Version = 1;
    public const int Piece = 64 * 1024;
    private const int Tag = 16;
    /// <summary>Magic, version, key id, the file key's nonce, the file key, its tag, the pieces' nonce prefix.</summary>
    public const int HeaderLength = 4 + 1 + 1 + 12 + 32 + Tag + 8;

    private readonly byte keyId;
    private readonly byte[] masterKey;

    public FileCipher(string? encodedKey, byte keyId = 1)
    {
        var key = string.IsNullOrWhiteSpace(encodedKey) ? null : Convert.FromBase64String(encodedKey.Trim());
        if (key is not { Length: 32 })
            throw new InvalidOperationException("Storage:EncryptionKey must be 32 bytes in base64 (FILES_KEY in .env: run deploy/init-env).");
        masterKey = key;
        this.keyId = keyId;
    }

    /// <summary>How many bytes a file of this size takes once encrypted.</summary>
    public static long SealedLength(long plain) => HeaderLength + plain + Tag * (plain / Piece + 1);

    /// <summary>The file's own size, from what the store holds of an encrypted one.</summary>
    public static long PlainLength(long sealedLength)
    {
        var body = sealedLength - HeaderLength;
        var pieces = body / (Piece + Tag) + 1;
        return body - Tag * pieces;
    }

    /// <summary>Whether these first bytes start an encrypted file.</summary>
    public static bool IsSealed(ReadOnlySpan<byte> head) => head.Length >= HeaderLength && head[..4].SequenceEqual(Magic) && head[4] == Version;

    /// <summary>Encrypts a whole file held in memory (a stamped copy, a preview, a list uploaded).</summary>
    public byte[] Seal(byte[] plain)
    {
        using var output = new MemoryStream((int)SealedLength(plain.Length));
        using (var input = new MemoryStream(plain)) SealAsync(input, output, CancellationToken.None).GetAwaiter().GetResult();
        return output.ToArray();
    }

    /// <summary>Encrypts what is read from <paramref name="input"/> into <paramref name="output"/>, piece by piece.</summary>
    public async Task SealAsync(Stream input, Stream output, CancellationToken cancellationToken)
    {
        var fileKey = RandomNumberGenerator.GetBytes(32);
        var header = new byte[HeaderLength];
        Magic.CopyTo(header, 0);
        header[4] = Version;
        header[5] = keyId;
        var keyNonce = header.AsSpan(6, 12);
        RandomNumberGenerator.Fill(keyNonce);
        using (var wrap = new AesGcm(masterKey, Tag))
            wrap.Encrypt(keyNonce, fileKey, header.AsSpan(18, 32), header.AsSpan(50, Tag), header.AsSpan(0, 6));
        RandomNumberGenerator.Fill(header.AsSpan(66, 8));
        await output.WriteAsync(header, cancellationToken);

        using var aes = new AesGcm(fileKey, Tag);
        var plain = new byte[Piece];
        var sealedPiece = new byte[Piece + Tag];
        uint index = 0;
        while (true)
        {
            var filled = await FillAsync(input, plain, cancellationToken);
            var last = filled < Piece;
            Seal(aes, header, index++, last, plain.AsSpan(0, filled), sealedPiece);
            await output.WriteAsync(sealedPiece.AsMemory(0, filled + Tag), cancellationToken);
            if (last) break;
        }
        CryptographicOperations.ZeroMemory(fileKey);
    }

    /// <summary>A stream that reads the file's own bytes from what the store holds; <paramref name="head"/> already read.</summary>
    public Stream Open(byte[] head, Stream rest) => new Opening(this, head, rest);

    private byte[] FileKey(ReadOnlySpan<byte> header)
    {
        if (header[5] != keyId) throw new CryptographicException($"The file was encrypted with key {header[5]}, not the key in use ({keyId}).");
        var fileKey = new byte[32];
        using var wrap = new AesGcm(masterKey, Tag);
        wrap.Decrypt(header.Slice(6, 12), header.Slice(18, 32), header.Slice(50, Tag), fileKey, header[..6]);
        return fileKey;
    }

    private static void Nonce(ReadOnlySpan<byte> header, uint index, Span<byte> nonce)
    {
        header.Slice(66, 8).CopyTo(nonce);
        BinaryPrimitives.WriteUInt32BigEndian(nonce[8..], index);
    }

    private static void Seal(AesGcm aes, byte[] header, uint index, bool last, ReadOnlySpan<byte> plain, byte[] into)
    {
        Span<byte> nonce = stackalloc byte[12];
        Nonce(header, index, nonce);
        aes.Encrypt(nonce, plain, into.AsSpan(0, plain.Length), into.AsSpan(plain.Length, Tag), [last ? (byte)1 : (byte)0]);
    }

    private static async Task<int> FillAsync(Stream input, byte[] buffer, CancellationToken cancellationToken)
    {
        var filled = 0;
        while (filled < buffer.Length)
        {
            var read = await input.ReadAsync(buffer.AsMemory(filled), cancellationToken);
            if (read == 0) break;
            filled += read;
        }
        return filled;
    }

    /// <summary>Reads an encrypted file piece by piece, each checked before a byte of it is given.</summary>
    private sealed class Opening : Stream
    {
        private readonly Stream inner;
        private readonly byte[] header;
        private readonly AesGcm aes;
        private readonly byte[] sealedPiece = new byte[Piece + Tag];
        private readonly byte[] plain = new byte[Piece];
        private int plainLength, plainAt;
        private uint index;
        private bool ended;

        public Opening(FileCipher cipher, byte[] head, Stream rest)
        {
            inner = rest;
            header = head;
            var fileKey = cipher.FileKey(head);
            aes = new AesGcm(fileKey, Tag);
            CryptographicOperations.ZeroMemory(fileKey);
        }

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            if (plainAt == plainLength)
            {
                if (ended) return 0;
                var filled = await FillAsync(inner, sealedPiece, cancellationToken);
                if (filled < Tag) throw new CryptographicException("The file is cut short.");
                var last = filled < sealedPiece.Length;
                Span<byte> nonce = stackalloc byte[12];
                Nonce(header, index++, nonce);
                plainLength = filled - Tag;
                aes.Decrypt(nonce, sealedPiece.AsSpan(0, plainLength), sealedPiece.AsSpan(plainLength, Tag), plain.AsSpan(0, plainLength),
                    [last ? (byte)1 : (byte)0]);
                plainAt = 0;
                ended = last;
                if (plainLength == 0) return 0;
            }
            var take = Math.Min(buffer.Length, plainLength - plainAt);
            plain.AsMemory(plainAt, take).CopyTo(buffer);
            plainAt += take;
            return take;
        }

        public override int Read(byte[] buffer, int offset, int count) =>
            ReadAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                aes.Dispose();
                inner.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}

/// <summary>What was read to look for a header, given back first, then the rest: a file kept before encryption.</summary>
internal sealed class Replay(byte[] head, int length, Stream rest) : Stream
{
    private int at;

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        if (at < length)
        {
            var take = Math.Min(buffer.Length, length - at);
            head.AsMemory(at, take).CopyTo(buffer);
            at += take;
            return take;
        }
        return await rest.ReadAsync(buffer, cancellationToken);
    }

    public override int Read(byte[] buffer, int offset, int count) =>
        ReadAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing) rest.Dispose();
        base.Dispose(disposing);
    }
}
