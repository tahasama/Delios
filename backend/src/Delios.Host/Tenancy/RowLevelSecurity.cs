using Microsoft.EntityFrameworkCore.Migrations;

namespace Delios.Host.Tenancy;

/// <summary>Used by migrations: tenant tables accept and return only the current tenant's rows.</summary>
public static class RowLevelSecurity
{
    private const string Current = "NULLIF(current_setting('app.tenant_id', true), '')::uuid";

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
