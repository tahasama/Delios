using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Azure.Storage.Blobs;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;

namespace Delios.Tests;

/// <summary>Azurite, Microsoft's Azure Storage emulator, with an account made up for this run.</summary>
public sealed class AzuriteFixture : IAsyncLifetime
{
    private const string Account = "delios";
    private static readonly string Key = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));

    public IContainer Container { get; } = new ContainerBuilder("mcr.microsoft.com/azure-storage/azurite:latest")
        .WithEnvironment("AZURITE_ACCOUNTS", $"{Account}:{Key}")
        .WithCommand("azurite-blob", "--blobHost", "0.0.0.0", "--skipApiVersionCheck", "--loose")
        .WithPortBinding(10000, true)
        .WithWaitStrategy(Wait.ForUnixContainer().UntilInternalTcpPortIsAvailable(10000))
        .Build();

    public string ConnectionString =>
        $"DefaultEndpointsProtocol=http;AccountName={Account};AccountKey={Key};" +
        $"BlobEndpoint=http://{Container.Hostname}:{Container.GetMappedPublicPort(10000)}/{Account};";

    public async Task InitializeAsync()
    {
        await Container.StartAsync();
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await new BlobContainerClient(ConnectionString, "delios").CreateIfNotExistsAsync();
                return;
            }
            catch (Exception) when (attempt < 30)
            {
                await Task.Delay(500);
            }
        }
    }

    public async Task DisposeAsync() => await Container.DisposeAsync();
}

public sealed class AzureStorageTests(Infrastructure infrastructure, AzuriteFixture azurite)
    : IClassFixture<Infrastructure>, IClassFixture<AzuriteFixture>
{
    [Fact]
    public async Task With_Azure_Blob_Storage_a_document_is_uploaded_scanned_released_stamped_and_downloaded()
    {
        await using var app = await TestApp.StartAsync(infrastructure, s =>
        {
            s["Storage:Provider"] = "azure";
            s["Storage:AzureConnectionString"] = azurite.ConnectionString;
            s.Remove("Storage:Endpoint");
        });
        app.StartWorker();
        var engineer = await app.SignedInAsync("engineer@demo.local");
        var approver = await app.SignedInAsync("approver@demo.local");
        var controller = await app.SignedInAsync("controller@demo.local");
        var pdf = Flow.Pdf(pages: 2);

        var p = await Flow.RevisionAsync(engineer, pdf: pdf);
        var (_, review) = await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/revisions/{p.Revision}/reviews", new { });
        var id = review.GetProperty("id").GetGuid();
        await Flow.PostAsync(engineer, $"/api/projects/{p.Project}/reviews/{id}/answer", new { });
        await Flow.PostAsync(approver, $"/api/projects/{p.Project}/reviews/{id}/answer", new { verdict = "C1", status = "IFC" });
        await Flow.PostAsync(controller, $"/api/projects/{p.Project}/reviews/{id}/release", new { });

        // The worker read the upload to scan it and wrote the stamped copy back.
        var document = await Flow.UntilAsync(engineer, p.Project, p.Document, d =>
            Flow.Revision(d, p.Revision).GetProperty("files").EnumerateArray().Any(f => f.GetProperty("kind").GetString() == "STAMPED"));
        var files = Flow.Revision(document, p.Revision).GetProperty("files").EnumerateArray().ToList();
        var original = files.Single(f => f.GetProperty("kind").GetString() == "RENDITION");
        Assert.Equal("CLEAN", original.GetProperty("status").GetString());

        // Downloaded through a signed link, byte for byte what was uploaded, named for saving.
        var link = await engineer.GetFromJsonAsync<JsonElement>(
            $"/api/projects/{p.Project}/files/{original.GetProperty("id").GetGuid()}/download");
        using var raw = new HttpClient();
        using var response = await raw.GetAsync(link.GetProperty("url").GetString());
        response.EnsureSuccessStatusCode();
        Assert.Equal(pdf, await response.Content.ReadAsByteArrayAsync());
        Assert.Contains("attachment", response.Content.Headers.ContentDisposition?.ToString());
    }
}
