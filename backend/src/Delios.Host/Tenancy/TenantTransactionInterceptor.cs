using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;

namespace Delios.Host.Tenancy;

/// <summary>
/// Tells Postgres which tenant every transaction works for, with <c>SET LOCAL</c>
/// semantics: the setting ends with the transaction, so a pooled connection
/// (Npgsql's pool now, PgBouncer later) never carries one tenant into another's
/// work. Row-level security policies read it; work outside a transaction, or
/// without a tenant, sees no tenant rows at all.
/// </summary>
public sealed class TenantTransactionInterceptor(TenantContext tenant) : DbTransactionInterceptor
{
    public override DbTransaction TransactionStarted(
        DbConnection connection, TransactionEndEventData eventData, DbTransaction result)
    {
        using var command = Command(connection, result);
        command?.ExecuteNonQuery();
        return result;
    }

    public override async ValueTask<DbTransaction> TransactionStartedAsync(
        DbConnection connection, TransactionEndEventData eventData, DbTransaction result,
        CancellationToken cancellationToken = default)
    {
        await using var command = Command(connection, result);
        if (command is not null) await command.ExecuteNonQueryAsync(cancellationToken);
        return result;
    }

    private NpgsqlCommand? Command(DbConnection connection, DbTransaction transaction)
    {
        if (tenant.TenantId is not { } id) return null;
        var command = new NpgsqlCommand("SELECT set_config('app.tenant_id', $1, true)",
            (NpgsqlConnection)connection, (NpgsqlTransaction)transaction);
        command.Parameters.Add(new NpgsqlParameter { Value = id.ToString() });
        return command;
    }
}
