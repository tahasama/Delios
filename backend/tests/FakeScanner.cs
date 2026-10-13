using System.Text;
using Delios.Host.Documents;
using Microsoft.Extensions.DependencyInjection;

namespace Delios.Tests;

/// <summary>Flags content containing the EICAR test marker; ClamAV itself is exercised in the compose stack.</summary>
public sealed class FakeScanner : IVirusScanner
{
    public const string Marker = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE";

    public static void Use(IServiceCollection services) => services.AddSingleton<IVirusScanner, FakeScanner>();

    public async Task<ScanResult> ScanAsync(Stream content, CancellationToken cancellationToken)
    {
        using var copy = new MemoryStream();
        await content.CopyToAsync(copy, cancellationToken);
        return Encoding.ASCII.GetString(copy.ToArray()).Contains(Marker, StringComparison.Ordinal)
            ? new ScanResult(true, "Eicar-Test-Signature")
            : new ScanResult(false, null);
    }
}
