using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Platform;

/// <summary>
/// Several writes as one (owner: an import is written whole, or not at all): each line goes through the very endpoint a
/// person uses by hand, in the request's one transaction. The first refusal ends the batch, names its line, and its
/// status rolls back everything written before it (<see cref="TransactionFilter"/>).
/// </summary>
public static class Batch
{
    /// <summary>Null when the answer is a success; else the refusal, its sentence led by the line it came from.</summary>
    public static IResult? Refused(IResult answer, string at)
    {
        if (answer is not IStatusCodeHttpResult { StatusCode: >= 400 } failed) return null;
        if (answer is ProblemHttpResult problem)
        {
            var extensions = problem.ProblemDetails.Extensions;
            return Results.Problem(statusCode: problem.StatusCode, title: $"{at}: {problem.ProblemDetails.Title}", extensions: new Dictionary<string, object?>
            {
                ["code"] = extensions.TryGetValue("code", out var code) ? code : "REFUSED",
                ["params"] = extensions.TryGetValue("params", out var parameters) ? parameters : null,
                ["line"] = at,
            });
        }
        return Problems.Problem(failed.StatusCode ?? 422, "REFUSED", $"{at}: refused.", null);
    }

    /// <summary>The id an endpoint answered with (<c>new { Id }</c>), read from its value.</summary>
    public static Guid? IdOf(IResult answer) =>
        (answer as IValueHttpResult)?.Value?.GetType().GetProperty("Id")?.GetValue((answer as IValueHttpResult)!.Value) as Guid?;

    /// <summary>
    /// Runs each line through its endpoint, each behind a savepoint: a line refused is undone alone, said, and the
    /// others go on, so every line's answer is known. A check (<paramref name="dry"/>) then undoes everything; a write
    /// keeps it only when no line was refused (the caller answers with a refusal otherwise, rolling the rest back).
    /// </summary>
    public static async Task<List<BatchLine>> RunAsync(DeliosDbContext db, IReadOnlyList<string> ats, Func<int, Task<IResult>> run, bool dry,
        CancellationToken cancellationToken)
    {
        var transaction = db.Database.CurrentTransaction ?? throw new InvalidOperationException("A batch runs inside the request's transaction.");
        await transaction.CreateSavepointAsync("batch", cancellationToken);
        var lines = new List<BatchLine>();
        for (var i = 0; i < ats.Count; i++)
        {
            await transaction.CreateSavepointAsync("line", cancellationToken);
            IResult answer;
            try { answer = await run(i); }
            catch (DbUpdateException e)
            {
                answer = Problems.Conflict("REFUSED", e.InnerException?.Message ?? e.Message);
            }
            if (answer is IStatusCodeHttpResult { StatusCode: >= 400 })
            {
                await transaction.RollbackToSavepointAsync("line", cancellationToken);
                db.ChangeTracker.Clear();
                var title = (answer as ProblemHttpResult)?.ProblemDetails.Title ?? "Refused.";
                lines.Add(new BatchLine(ats[i], false, title, null));
            }
            else lines.Add(new BatchLine(ats[i], true, null, (answer as IValueHttpResult)?.Value));
        }
        if (dry)
        {
            await transaction.RollbackToSavepointAsync("batch", cancellationToken);
            db.ChangeTracker.Clear();
        }
        return lines;
    }

    /// <summary>A batch's answer: every line, and, written, whether all of it was (409 with the lines otherwise, nothing kept).</summary>
    public static IResult Answer(List<BatchLine> lines, bool dry) =>
        dry || lines.All(l => l.Ok) ? Results.Ok(new { lines, written = !dry })
            : Results.Json(new { lines, written = false, code = "LINES_REFUSED", title = "Nothing was written: some lines were refused." }, statusCode: StatusCodes.Status409Conflict);
}

/// <summary>One line of a batch: where it is in the file, whether it passes, why not, and what its endpoint answered.</summary>
public sealed record BatchLine(string At, bool Ok, string? Problem, object? Value);
