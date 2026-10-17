using System;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// A list holds sets (value_sets): each serves the deliverable types it names, the default one the rest. Every list
    /// there is today becomes one list with one set, "Default", serving every deliverable type, and its values go in it
    /// (value_entries.set_id), so nothing changes for what is already registered. A value whose set or list is switched
    /// off reads OFF.
    /// </summary>
    public partial class ListSets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "value_sets",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    list_key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    deliverable_types = table.Column<string[]>(type: "text[]", nullable: false),
                    is_default = table.Column<bool>(type: "boolean", nullable: false),
                    active = table.Column<bool>(type: "boolean", nullable: false),
                    sort = table.Column<int>(type: "integer", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_value_sets", x => x.id);
                    table.ForeignKey(
                        name: "fk_value_sets_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });
            migrationBuilder.CreateIndex(
                name: "ix_value_sets_org_list_name",
                table: "value_sets",
                columns: new[] { "tenant_id", "list_key", "name" },
                unique: true,
                filter: "project_id IS NULL");
            migrationBuilder.CreateIndex(
                name: "ix_value_sets_project_list_name",
                table: "value_sets",
                columns: new[] { "tenant_id", "project_id", "list_key", "name" },
                unique: true,
                filter: "project_id IS NOT NULL");
            RowLevelSecurity.Enable(migrationBuilder, "value_sets");

            migrationBuilder.AddColumn<Guid>(name: "set_id", table: "value_entries", type: "uuid", nullable: true);

            migrationBuilder.Sql("""
                DO $$
                DECLARE t record;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        INSERT INTO value_sets (id, tenant_id, project_id, list_key, name, deliverable_types, is_default, active, sort)
                        SELECT gen_random_uuid(), v.tenant_id, v.project_id, v.set_key, 'Default', '{}', true, true, 0
                        FROM (SELECT DISTINCT tenant_id, project_id, set_key FROM value_entries) v;
                        UPDATE value_entries e SET set_id = s.id
                        FROM value_sets s
                        WHERE s.tenant_id = e.tenant_id AND s.list_key = e.set_key AND s.is_default
                          AND s.project_id IS NOT DISTINCT FROM e.project_id;
                    END LOOP;
                    PERFORM set_config('app.tenant_id', '', true);
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("UPDATE value_entries SET status = 'ACTIVE' WHERE status = 'OFF';");
            migrationBuilder.DropColumn(name: "set_id", table: "value_entries");
            RowLevelSecurity.Disable(migrationBuilder, "value_sets");
            migrationBuilder.DropTable(name: "value_sets");
        }
    }
}
