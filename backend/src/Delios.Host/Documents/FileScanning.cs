using System.Buffers.Binary;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using Delios.Host.Platform;
using Microsoft.Extensions.Options;

namespace Delios.Host.Documents;

public sealed record ScanResult(bool Infected, string? Signature);

public interface IVirusScanner
{
    /// <summary>Reads the stream to its end. Throws when the scanner could not decide.</summary>
    Task<ScanResult> ScanAsync(Stream content, CancellationToken cancellationToken);
}

/// <summary>Streams the file to clamd with INSTREAM; nothing is written to disk.</summary>
public sealed class ClamAvScanner(IOptions<ClamAvOptions> options) : IVirusScanner
{
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

    public long BytesRead { get; private set; }
    public ReadOnlySpan<byte> Head => _head.AsSpan(0, _headLength);
    public string Sha256Hex() => Convert.ToHexStringLower(_hash.GetCurrentHash());

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        var read = await inner.ReadAsync(buffer, cancellationToken);
        Track(buffer.Span[..read]);
        return read;
    }

    public override int Read(byte[] buffer, int offset, int count)
    {
        var read = inner.Read(buffer, offset, count);
        Track(buffer.AsSpan(offset, read));
        return read;
    }

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
    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

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
