using Microsoft.EntityFrameworkCore.Migrations;

namespace Delios.Host.Tenancy;

/// <summary>Used by migrations: tenant tables accept and return only the current tenant's rows.</summary>
public static class RowLevelSecurity
{
    /// <summary>SQL expression that reads the tenant id set for the current transaction (by <see cref="TenantTransactionInterceptor"/>); null when none is set.</summary>
    private const string Current = "NULLIF(current_setting('app.tenant_id', true), '')::uuid";

    /// <summary>
    /// Turns on row-level security (Postgres filtering rows per policy) for each table, with a policy that only lets the current tenant's rows be read or written.
    /// Called from the Up method of migrations that create tenant tables.
    /// </summary>
    public static void Enable(MigrationBuilder migration, params string[] tables)
    {
        foreach (var table in tables)
        {
            migration.Sql($"""
                ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
                ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
                CREATE POLICY tenant_isolation ON {table}
                    USING (tenant_id = {Current})
                    WITH CHECK (tenant_id = {Current});
                """);
        }
    }

    /// <summary>Removes the tenant policy and turns row-level security off again for each table. Called from the Down method of migrations.</summary>
    public static void Disable(MigrationBuilder migration, params string[] tables)
    {
        foreach (var table in tables)
        {
            migration.Sql($"""
                DROP POLICY IF EXISTS tenant_isolation ON {table};
                ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;
                ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;
                """);
        }
    }
}
