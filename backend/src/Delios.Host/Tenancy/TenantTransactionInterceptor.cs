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
    /// <summary>Called by Entity Framework right after a transaction begins (synchronous path); sets the tenant on it.</summary>
    public override DbTransaction TransactionStarted(
        DbConnection connection, TransactionEndEventData eventData, DbTransaction result)
    {
        using var command = Command(connection, result);
        command?.ExecuteNonQuery();
        return result;
    }

    /// <summary>Called by Entity Framework right after a transaction begins (async path); sets the tenant on it.</summary>
    public override async ValueTask<DbTransaction> TransactionStartedAsync(
        DbConnection connection, TransactionEndEventData eventData, DbTransaction result,
        CancellationToken cancellationToken = default)
    {
        await using var command = Command(connection, result);
        if (command is not null) await command.ExecuteNonQueryAsync(cancellationToken);
        return result;
    }

    /// <summary>
    /// Builds the <c>set_config('app.tenant_id', ..., true)</c> command for the transaction, where <c>true</c> means "only until the transaction ends".
    /// Returns null when no tenant is set, so nothing is run.
    /// </summary>
    private NpgsqlCommand? Command(DbConnection connection, DbTransaction transaction)
    {
        if (tenant.TenantId is not { } id) return null;
        var command = new NpgsqlCommand("SELECT set_config('app.tenant_id', $1, true)",
            (NpgsqlConnection)connection, (NpgsqlTransaction)transaction);
        command.Parameters.Add(new NpgsqlParameter { Value = id.ToString() });
        return command;
    }
}
