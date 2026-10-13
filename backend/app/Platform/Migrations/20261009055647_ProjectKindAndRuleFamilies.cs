using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class ProjectKindAndRuleFamilies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "kind",
                table: "projects",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "GENERIC");

            migrationBuilder.AddColumn<string>(
                name: "family",
                table: "permission_rules",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "note",
                table: "permission_rules",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            // A project's kind was kept in its own answers (PROJECT_INFO); it now lives on the project.
            migrationBuilder.Sql("""
                DO $$
                DECLARE t record;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        UPDATE projects p
                            SET kind = left(upper(substring(s.value from '"kind"\s*:\s*"([^"]+)"')), 32)
                            FROM settings s
                            WHERE s.project_id = p.id AND s.key = 'PROJECT_INFO' AND s.value ~ '"kind"\s*:\s*"[^"]+"';
                    END LOOP;
                    PERFORM set_config('app.tenant_id', '', true);
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "kind",
                table: "projects");

            migrationBuilder.DropColumn(
                name: "family",
                table: "permission_rules");

            migrationBuilder.DropColumn(
                name: "note",
                table: "permission_rules");
        }
    }
}
