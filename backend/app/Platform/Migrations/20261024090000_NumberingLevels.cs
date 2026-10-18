using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// Numbering on two levels (owner): the organization's schemes and routing (project_id empty) are every project's;
    /// a project's own copy (project_id set) only where numbering is free for projects. A scheme keeps when it is used
    /// (notes) and whether it gave a number (used): from then on its parts stay as they are. Schemes routed to what
    /// already carries numbers are marked used.
    /// </summary>
    public partial class NumberingLevels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "notes", table: "numbering_schemes", type: "character varying(300)", maxLength: 300, nullable: true);
            migrationBuilder.AddColumn<bool>(name: "used", table: "numbering_schemes", type: "boolean", nullable: false, defaultValue: false);
            migrationBuilder.AddColumn<Guid>(name: "project_id", table: "numbering_schemes", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "project_id", table: "scheme_routings", type: "uuid", nullable: true);

            migrationBuilder.DropIndex(name: "ix_numbering_schemes_tenant_id_name", table: "numbering_schemes");
            migrationBuilder.DropIndex(name: "ix_scheme_routings_tenant_id_deliverable_type", table: "scheme_routings");

            migrationBuilder.CreateIndex(name: "ix_numbering_schemes_project_id", table: "numbering_schemes", column: "project_id");
            migrationBuilder.CreateIndex(name: "ix_numbering_schemes_tenant_id_project_id_name", table: "numbering_schemes",
                columns: ["tenant_id", "project_id", "name"], unique: true).Annotation("Npgsql:NullsDistinct", false);
            migrationBuilder.CreateIndex(name: "ix_scheme_routings_project_id", table: "scheme_routings", column: "project_id");
            migrationBuilder.CreateIndex(name: "ix_scheme_routings_tenant_id_project_id_deliverable_type", table: "scheme_routings",
                columns: ["tenant_id", "project_id", "deliverable_type"], unique: true).Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.AddForeignKey(name: "fk_numbering_schemes_projects_project_id", table: "numbering_schemes", column: "project_id",
                principalTable: "projects", principalColumn: "id", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "fk_scheme_routings_projects_project_id", table: "scheme_routings", column: "project_id",
                principalTable: "projects", principalColumn: "id", onDelete: ReferentialAction.Restrict);

            migrationBuilder.Sql("""
                DO $$
                DECLARE t record;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        UPDATE numbering_schemes s SET used = true
                        WHERE EXISTS (SELECT 1 FROM scheme_routings r WHERE r.scheme_id = s.id AND (
                            (r.deliverable_type = '@TRANSMITTAL' AND EXISTS (SELECT 1 FROM transmittals))
                            OR (r.deliverable_type = '@REVIEW' AND EXISTS (SELECT 1 FROM reviews))
                            OR (r.deliverable_type = '@PACKAGE' AND EXISTS (SELECT 1 FROM packages))
                            OR (r.deliverable_type = '@ASSET' AND EXISTS (SELECT 1 FROM assets))
                            OR (r.deliverable_type = '@ACTION')
                            OR EXISTS (SELECT 1 FROM documents d WHERE d.deliverable_type = r.deliverable_type)));
                    END LOOP;
                    PERFORM set_config('app.tenant_id', '', true);
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "fk_numbering_schemes_projects_project_id", table: "numbering_schemes");
            migrationBuilder.DropForeignKey(name: "fk_scheme_routings_projects_project_id", table: "scheme_routings");
            migrationBuilder.DropIndex(name: "ix_numbering_schemes_project_id", table: "numbering_schemes");
            migrationBuilder.DropIndex(name: "ix_numbering_schemes_tenant_id_project_id_name", table: "numbering_schemes");
            migrationBuilder.DropIndex(name: "ix_scheme_routings_project_id", table: "scheme_routings");
            migrationBuilder.DropIndex(name: "ix_scheme_routings_tenant_id_project_id_deliverable_type", table: "scheme_routings");
            migrationBuilder.DropColumn(name: "notes", table: "numbering_schemes");
            migrationBuilder.DropColumn(name: "used", table: "numbering_schemes");
            migrationBuilder.DropColumn(name: "project_id", table: "numbering_schemes");
            migrationBuilder.DropColumn(name: "project_id", table: "scheme_routings");
            migrationBuilder.CreateIndex(name: "ix_numbering_schemes_tenant_id_name", table: "numbering_schemes", columns: ["tenant_id", "name"], unique: true);
            migrationBuilder.CreateIndex(name: "ix_scheme_routings_tenant_id_deliverable_type", table: "scheme_routings", columns: ["tenant_id", "deliverable_type"], unique: true);
        }
    }
}
