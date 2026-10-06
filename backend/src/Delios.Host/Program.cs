using Delios.Host.Platform;
using Serilog;
using Serilog.Formatting.Compact;

// The container image has no shell or curl, so its health probe runs this binary.
if (args.Contains(HealthProbe.Command))
{
    return await HealthProbe.RunAsync();
}

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console(new RenderedCompactJsonFormatter())
    .CreateBootstrapLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);
    builder.AddPlatform();

    var app = builder.Build();

    // Migrations run once, from a one-shot container, never on every node's start.
    if (args.Contains(DatabaseMigrator.Command))
    {
        await DatabaseMigrator.ApplyAsync(app.Services);
        return 0;
    }

    app.UsePlatform();
    await app.RunAsync();
    return 0;
}
catch (Exception ex) when (ex is not HostAbortedException)
{
    Log.Fatal(ex, "Delios stopped unexpectedly");
    return 1;
}
finally
{
    await Log.CloseAndFlushAsync();
}

public partial class Program;
