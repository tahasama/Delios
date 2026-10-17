using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// A project's type is chosen from the organization's own list, Project types (PROJECT_KINDS), no longer from codes
    /// written in the app. Each organization's list starts with the four types the app offered, and any other type one of
    /// its projects carries: codes once used stay. Nothing already there is touched.
    /// </summary>
    public partial class ProjectKindsList : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$
                DECLARE t record;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        INSERT INTO value_entries (id, tenant_id, set_key, code, label, sort, status)
                        SELECT gen_random_uuid(), t.id, 'PROJECT_KINDS', k.code, k.label, k.sort, 'ACTIVE'
                        FROM (
                            SELECT * FROM (VALUES
                                ('GENERIC', 'General', 0), ('INDUSTRIAL', 'Industrial / process plant', 1),
                                ('ENERGY', 'Energy / power', 2), ('CONSTRUCTION', 'Construction / buildings', 3)) AS v(code, label, sort)
                            UNION
                            SELECT DISTINCT p.kind, initcap(lower(replace(p.kind, '_', ' '))), 10 FROM projects p
                            WHERE p.tenant_id = t.id AND p.kind NOT IN ('GENERIC', 'INDUSTRIAL', 'ENERGY', 'CONSTRUCTION')
                        ) k
                        WHERE NOT EXISTS (SELECT 1 FROM value_entries e WHERE e.tenant_id = t.id AND e.set_key = 'PROJECT_KINDS' AND e.code = k.code);
                    END LOOP;
                    PERFORM set_config('app.tenant_id', '', true);
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
