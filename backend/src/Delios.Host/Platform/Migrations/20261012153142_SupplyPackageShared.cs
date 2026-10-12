using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class SupplyPackageShared : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "auto_created",
                table: "packages",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Instant>(
                name: "shared_at",
                table: "packages",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "shared_by_name",
                table: "packages",
                type: "text",
                nullable: true);

            // Supply packages made before: their supplier already saw them, so they stay shared.
            migrationBuilder.Sql("""
                DO $$
                DECLARE t record;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        UPDATE packages SET shared_at = created_at, shared_by_name = created_by_name
                        WHERE tenant_id = t.id AND kind = 'SUPPLY' AND shared_at IS NULL;
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
                name: "auto_created",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "shared_at",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "shared_by_name",
                table: "packages");
        }
    }
}
