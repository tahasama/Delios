using System.Buffers.Binary;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using Delios.Host.Platform;
using Microsoft.Extensions.Options;

namespace Delios.Host.Documents;

/// <summary>The virus scanner's answer: whether the file is infected and, if so, the name of what was found.</summary>
public sealed record ScanResult(bool Infected, string? Signature);

/// <summary>
/// Something that scans file bytes for viruses. <see cref="ClamAvScanner"/> is the real one; tests can swap in a fake.
/// Used by <see cref="FileProcessor"/>.
/// </summary>
public interface IVirusScanner
{
    /// <summary>Reads the stream to its end. Throws when the scanner could not decide.</summary>
    Task<ScanResult> ScanAsync(Stream content, CancellationToken cancellationToken);
}

/// <summary>Streams the file to clamd with INSTREAM; nothing is written to disk.</summary>
public sealed class ClamAvScanner(IOptions<ClamAvOptions> options) : IVirusScanner
{
    /// <summary>
    /// Opens a TCP connection to the clamd service, sends the bytes in chunks (each prefixed with its length, ending
    /// with a zero length), then reads the reply: "... OK" means clean, "... FOUND" means infected; anything else throws.
    /// </summary>
    public async Task<ScanResult> ScanAsync(Stream content, CancellationToken cancellationToken)
    {
        using var client = new TcpClient();
        await client.ConnectAsync(options.Value.Host, options.Value.Port, cancellationToken);
        await using var clamd = client.GetStream();
        await clamd.WriteAsync("zINSTREAM\0"u8.ToArray(), cancellationToken);

        var buffer = new byte[64 * 1024];
        var length = new byte[4];
        int read;
        while ((read = await content.ReadAsync(buffer, cancellationToken)) > 0)
        {
            BinaryPrimitives.WriteInt32BigEndian(length, read);
            await clamd.WriteAsync(length, cancellationToken);
            await clamd.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }
        BinaryPrimitives.WriteInt32BigEndian(length, 0);
        await clamd.WriteAsync(length, cancellationToken);

        using var reply = new MemoryStream();
        while ((read = await clamd.ReadAsync(buffer, cancellationToken)) > 0)
        {
            reply.Write(buffer, 0, read);
            if (buffer[read - 1] == 0) break;
        }
        var text = Encoding.ASCII.GetString(reply.ToArray()).TrimEnd('\0').Trim();

        if (text.EndsWith(" OK", StringComparison.Ordinal)) return new ScanResult(false, null);
        if (text.EndsWith(" FOUND", StringComparison.Ordinal))
        {
            var signature = text[(text.IndexOf(": ", StringComparison.Ordinal) + 2)..^" FOUND".Length];
            return new ScanResult(true, signature);
        }
        throw new InvalidOperationException($"ClamAV could not scan the file: {text}");
    }
}

/// <summary>Counts and hashes what passes through it, and keeps the first bytes for type detection.</summary>
public sealed class HashingStream(Stream inner) : Stream
{
    private readonly IncrementalHash _hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    private readonly byte[] _head = new byte[16];
    private int _headLength;

    /// <summary>How many bytes have been read through the stream so far.</summary>
    public long BytesRead { get; private set; }
    /// <summary>The first bytes read (up to 16), used by <see cref="FileSniffer"/> to tell the file type.</summary>
    public ReadOnlySpan<byte> Head => _head.AsSpan(0, _headLength);
    /// <summary>The SHA-256 of everything read so far, as lowercase hexadecimal. Call it after reading to the end.</summary>
    public string Sha256Hex() => Convert.ToHexStringLower(_hash.GetCurrentHash());

    /// <summary>Reads from the inner stream and records what passed through (hash, count, first bytes).</summary>
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        var read = await inner.ReadAsync(buffer, cancellationToken);
        Track(buffer.Span[..read]);
        return read;
    }

    /// <summary>Reads from the inner stream and records what passed through (hash, count, first bytes).</summary>
    public override int Read(byte[] buffer, int offset, int count)
    {
        var read = inner.Read(buffer, offset, count);
        Track(buffer.AsSpan(offset, read));
        return read;
    }

    /// <summary>Adds the bytes to the hash, keeps them if the first 16 bytes are not yet filled, and counts them.</summary>
    private void Track(ReadOnlySpan<byte> data)
    {
        _hash.AppendData(data);
        if (_headLength < _head.Length)
        {
            var take = Math.Min(_head.Length - _headLength, data.Length);
            data[..take].CopyTo(_head.AsSpan(_headLength));
            _headLength += take;
        }
        BytesRead += data.Length;
    }

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => BytesRead; set => throw new NotSupportedException(); }
    /// <summary>Does nothing: the stream is read-only.</summary>
    public override void Flush() { }
    /// <summary>Not supported: the stream is read once, from start to end.</summary>
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    /// <summary>Not supported: the stream is read-only.</summary>
    public override void SetLength(long value) => throw new NotSupportedException();
    /// <summary>Not supported: the stream is read-only.</summary>
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    /// <summary>Releases the hash and closes the inner stream along with this one.</summary>
    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _hash.Dispose();
            inner.Dispose();
        }
        base.Dispose(disposing);
    }
}

/// <summary>What a file is, from its first bytes. The name and declared type can say anything.</summary>
public static class FileSniffer
{
    /// <summary>
    /// Returns a content type (such as <c>application/pdf</c>) from the file's first bytes, its "magic number",
    /// or <c>application/octet-stream</c> when none is recognised.
    /// </summary>
    public static string Detect(ReadOnlySpan<byte> head) => head switch
    {
        [0x25, 0x50, 0x44, 0x46, ..] => "application/pdf",
        [0x50, 0x4B, 0x03, 0x04, ..] => "application/zip",
        [0x41, 0x43, 0x31, 0x30, ..] => "image/vnd.dwg",
        [0xD0, 0xCF, 0x11, 0xE0, ..] => "application/x-ole-storage",
        [0x89, 0x50, 0x4E, 0x47, ..] => "image/png",
        [0xFF, 0xD8, 0xFF, ..] => "image/jpeg",
        [0x49, 0x49, 0x2A, 0x00, ..] or [0x4D, 0x4D, 0x00, 0x2A, ..] => "image/tiff",
        [0x49, 0x53, 0x4F, 0x2D, 0x31, 0x30, 0x33, 0x30, 0x33, ..] => "model/ifc",
        _ => "application/octet-stream",
    };
}
