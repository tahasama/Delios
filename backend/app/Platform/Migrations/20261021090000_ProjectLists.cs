using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// Lists become the project's: the organization's lists (no project) are the default every project reads until it
    /// changes one, then it keeps its own copy (value_entries.project_id, projects.own_lists). Who opened each project is
    /// kept (projects.opened_by_id): where a project has no control function, they alone change its lists. For projects
    /// opened before, it is read from the log, else the first person put on it.
    /// </summary>
    public partial class ProjectLists : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(name: "project_id", table: "value_entries", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "opened_by_id", table: "projects", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<bool>(name: "own_lists", table: "projects", type: "boolean", nullable: false, defaultValue: false);

            migrationBuilder.DropIndex(name: "ix_value_entries_tenant_id_set_key_code", table: "value_entries");
            migrationBuilder.CreateIndex(
                name: "ix_value_entries_org_set_code",
                table: "value_entries",
                columns: new[] { "tenant_id", "set_key", "code" },
                unique: true,
                filter: "project_id IS NULL");
            migrationBuilder.CreateIndex(
                name: "ix_value_entries_project_set_code",
                table: "value_entries",
                columns: new[] { "tenant_id", "project_id", "set_key", "code" },
                unique: true,
                filter: "project_id IS NOT NULL");

            migrationBuilder.Sql("""
                DO $$
                DECLARE t record;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        UPDATE projects p SET opened_by_id = (
                            SELECT a.actor_id FROM audit_events a
                            WHERE a.action = 'PROJECT_CREATED' AND a.entity_id = p.id AND a.actor_id IS NOT NULL
                            ORDER BY a.id LIMIT 1)
                        WHERE p.opened_by_id IS NULL;
                        UPDATE projects p SET opened_by_id = (
                            SELECT m.user_id FROM memberships m WHERE m.project_id = p.id ORDER BY m.id LIMIT 1)
                        WHERE p.opened_by_id IS NULL;
                    END LOOP;
                    PERFORM set_config('app.tenant_id', '', true);
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DELETE FROM value_entries WHERE project_id IS NOT NULL;");
            migrationBuilder.DropIndex(name: "ix_value_entries_project_set_code", table: "value_entries");
            migrationBuilder.DropIndex(name: "ix_value_entries_org_set_code", table: "value_entries");
            migrationBuilder.CreateIndex(name: "ix_value_entries_tenant_id_set_key_code", table: "value_entries",
                columns: new[] { "tenant_id", "set_key", "code" }, unique: true);
            migrationBuilder.DropColumn(name: "project_id", table: "value_entries");
            migrationBuilder.DropColumn(name: "opened_by_id", table: "projects");
            migrationBuilder.DropColumn(name: "own_lists", table: "projects");
        }
    }
}
