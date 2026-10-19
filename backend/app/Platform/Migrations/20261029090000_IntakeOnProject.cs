using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class IntakeOnProject : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // A supplier's package switched to take documents as they come puts its project on that way (owner: one way
            // per project), with what it filed them under.
            migrationBuilder.Sql("""
                DO $$
                DECLARE t record;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        INSERT INTO settings (id, tenant_id, project_id, key, value, updated_at, updated_by_name)
                        SELECT DISTINCT ON (p.project_id) gen_random_uuid(), p.tenant_id, p.project_id, 'SUPPLIER_INTAKE', 'AS_RECEIVED', now(), coalesce(p.as_received_by_name, 'migration')
                        FROM packages p WHERE p.tenant_id = t.id AND p.takes_as_received
                        ON CONFLICT DO NOTHING;
                        INSERT INTO settings (id, tenant_id, project_id, key, value, updated_at, updated_by_name)
                        SELECT DISTINCT ON (p.project_id) gen_random_uuid(), p.tenant_id, p.project_id, 'AS_RECEIVED_FILING',
                            p.as_received_deliverable_type || '|' || p.as_received_doc_type || '|' || p.as_received_discipline, now(), coalesce(p.as_received_by_name, 'migration')
                        FROM packages p WHERE p.tenant_id = t.id AND p.takes_as_received
                        ON CONFLICT DO NOTHING;
                    END LOOP;
                    PERFORM set_config('app.tenant_id', '', true);
                END $$;
                """);

            migrationBuilder.DropColumn(
                name: "as_received_at",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "as_received_by_name",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "as_received_deliverable_type",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "as_received_discipline",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "as_received_doc_type",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "takes_as_received",
                table: "packages");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Instant>(
                name: "as_received_at",
                table: "packages",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "as_received_by_name",
                table: "packages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "as_received_deliverable_type",
                table: "packages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "as_received_discipline",
                table: "packages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "as_received_doc_type",
                table: "packages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "takes_as_received",
                table: "packages",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }
    }
}
