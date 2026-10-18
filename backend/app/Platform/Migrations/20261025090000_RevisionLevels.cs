using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// Revision naming on two levels (owner): the organization's schemes and routing (project_id empty) name every
    /// project's revisions; a project's own copy (project_id set) only where revisions are free for projects. One default
    /// per organization, and per project's own copy.
    /// </summary>
    public partial class RevisionLevels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(name: "project_id", table: "revision_schemes", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "project_id", table: "revision_scheme_routings", type: "uuid", nullable: true);

            migrationBuilder.DropIndex(name: "ix_revision_schemes_one_default", table: "revision_schemes");
            migrationBuilder.DropIndex(name: "ix_revision_schemes_tenant_id_name", table: "revision_schemes");
            migrationBuilder.DropIndex(name: "ix_revision_scheme_routings_tenant_id_deliverable_type", table: "revision_scheme_routings");

            migrationBuilder.CreateIndex(name: "ix_revision_schemes_project_id", table: "revision_schemes", column: "project_id");
            migrationBuilder.CreateIndex(name: "ix_revision_schemes_one_default", table: "revision_schemes", columns: ["tenant_id", "project_id"],
                unique: true, filter: "is_default").Annotation("Npgsql:NullsDistinct", false);
            migrationBuilder.CreateIndex(name: "ix_revision_schemes_tenant_id_project_id_name", table: "revision_schemes",
                columns: ["tenant_id", "project_id", "name"], unique: true).Annotation("Npgsql:NullsDistinct", false);
            migrationBuilder.CreateIndex(name: "ix_revision_scheme_routings_project_id", table: "revision_scheme_routings", column: "project_id");
            migrationBuilder.CreateIndex(name: "ix_revision_scheme_routings_tenant_id_project_id_deliverable_ty", table: "revision_scheme_routings",
                columns: ["tenant_id", "project_id", "deliverable_type"], unique: true).Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.AddForeignKey(name: "fk_revision_schemes_projects_project_id", table: "revision_schemes", column: "project_id",
                principalTable: "projects", principalColumn: "id", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "fk_revision_scheme_routings_projects_project_id", table: "revision_scheme_routings", column: "project_id",
                principalTable: "projects", principalColumn: "id", onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "fk_revision_schemes_projects_project_id", table: "revision_schemes");
            migrationBuilder.DropForeignKey(name: "fk_revision_scheme_routings_projects_project_id", table: "revision_scheme_routings");
            migrationBuilder.DropIndex(name: "ix_revision_schemes_project_id", table: "revision_schemes");
            migrationBuilder.DropIndex(name: "ix_revision_schemes_one_default", table: "revision_schemes");
            migrationBuilder.DropIndex(name: "ix_revision_schemes_tenant_id_project_id_name", table: "revision_schemes");
            migrationBuilder.DropIndex(name: "ix_revision_scheme_routings_project_id", table: "revision_scheme_routings");
            migrationBuilder.DropIndex(name: "ix_revision_scheme_routings_tenant_id_project_id_deliverable_ty", table: "revision_scheme_routings");
            migrationBuilder.DropColumn(name: "project_id", table: "revision_schemes");
            migrationBuilder.DropColumn(name: "project_id", table: "revision_scheme_routings");
            migrationBuilder.CreateIndex(name: "ix_revision_schemes_one_default", table: "revision_schemes", column: "tenant_id", unique: true, filter: "is_default");
            migrationBuilder.CreateIndex(name: "ix_revision_schemes_tenant_id_name", table: "revision_schemes", columns: ["tenant_id", "name"], unique: true);
            migrationBuilder.CreateIndex(name: "ix_revision_scheme_routings_tenant_id_deliverable_type", table: "revision_scheme_routings", columns: ["tenant_id", "deliverable_type"], unique: true);
        }
    }
}
