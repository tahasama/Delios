namespace Delios.Host.Platform;

/// <summary>The container's own liveness probe: <c>dotnet Delios.Host.dll healthcheck</c>.</summary>
public static class HealthProbe
{
    /// <summary>Command-line argument that makes the program run this probe instead of the web server.</summary>
    public const string Command = "healthcheck";

    /// <summary>
    /// Calls this app's own <c>/health/live</c> endpoint on localhost and returns 0 when it answers with success, 1 otherwise (error or no answer within 3 seconds).
    /// Called from Program.cs; the container runtime treats exit code 0 as healthy.
    /// </summary>
    public static async Task<int> RunAsync()
    {
        var port = Environment.GetEnvironmentVariable("ASPNETCORE_HTTP_PORTS")?.Split(';')[0] ?? "8080";
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
        try
        {
            using var response = await http.GetAsync(new Uri($"http://localhost:{port}/health/live"));
            return response.IsSuccessStatusCode ? 0 : 1;
        }
        catch (HttpRequestException)
        {
            return 1;
        }
        catch (TaskCanceledException)
        {
            return 1;
        }
    }
}
