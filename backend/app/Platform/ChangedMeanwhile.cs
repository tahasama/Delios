using Microsoft.AspNetCore.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Delios.Host.Platform;

/// <summary>
/// Two people saving the same thing at the same moment (owner): the second is refused in plain words, never as a fault
/// of ours. A record carrying a version stamp changed since it was read (<see cref="DbUpdateConcurrencyException"/>), or
/// the database stopping one of two transactions that clashed (serialization failure 40001, deadlock 40P01). Nothing of
/// the refused request was kept (its transaction rolled back), so sending it again is safe.
/// </summary>
public sealed class ChangedMeanwhile(ILogger<ChangedMeanwhile> logger) : IExceptionHandler
{
    public const string Code = "CHANGED_MEANWHILE";

    public async ValueTask<bool> TryHandleAsync(HttpContext http, Exception exception, CancellationToken cancellationToken)
    {
        if (!Clashed(exception) || http.Response.HasStarted) return false;
        logger.LogInformation("Refused {Method} {Path}: changed by someone else at the same moment", http.Request.Method, http.Request.Path);
        http.Response.StatusCode = StatusCodes.Status409Conflict;
        await Problems.Conflict(Code, "Someone else changed this at the same moment, so nothing of yours was saved. Look at it again, then send it again.")
            .ExecuteAsync(http);
        return true;
    }

    private static bool Clashed(Exception exception)
    {
        for (var e = exception; e is not null; e = e.InnerException)
        {
            if (e is DbUpdateConcurrencyException) return true;
            if (e is PostgresException { SqlState: PostgresErrorCodes.SerializationFailure or PostgresErrorCodes.DeadlockDetected }) return true;
        }
        return false;
    }
}
