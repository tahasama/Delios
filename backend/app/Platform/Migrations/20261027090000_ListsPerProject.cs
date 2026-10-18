using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class ListsPerProject : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string[]>(
                name: "own_list_keys",
                table: "projects",
                type: "text[]",
                nullable: false,
                defaultValue: new string[0]);

            // A project that had its own copy had a copy of every list there was: it keeps each, marked as its own, so
            // nothing it reads changes. Row-level security is forced: one organization at a time.
            migrationBuilder.Sql("""
                DO $$
                DECLARE t record;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        UPDATE projects p SET own_list_keys = COALESCE((
                            SELECT array_agg(DISTINCT k ORDER BY k) FROM (
                                SELECT v.set_key AS k FROM value_entries v WHERE v.tenant_id = t.id AND (v.project_id = p.id OR v.project_id IS NULL)
                                UNION SELECT s.list_key FROM value_sets s WHERE s.tenant_id = t.id AND (s.project_id = p.id OR s.project_id IS NULL)
                                UNION SELECT substr(g.key, 5) FROM settings g WHERE g.tenant_id = t.id AND g.project_id = p.id AND g.key LIKE 'SET:%'
                            ) keys), '{}')
                        WHERE p.tenant_id = t.id AND p.own_lists;
                    END LOOP;
                    PERFORM set_config('app.tenant_id', '', true);
                END
                $$;
                """);

            migrationBuilder.DropColumn(
                name: "own_lists",
                table: "projects");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "own_list_keys",
                table: "projects");

            migrationBuilder.AddColumn<bool>(
                name: "own_lists",
                table: "projects",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }
    }
}
