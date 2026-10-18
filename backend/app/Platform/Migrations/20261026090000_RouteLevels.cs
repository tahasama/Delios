using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// Review routes on two levels (owner): the organization's (project_id empty) are offered on every project; a project's
    /// own copy (project_id set) only where routes are free for projects and the project changed them.
    /// </summary>
    public partial class RouteLevels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(name: "project_id", table: "review_routes", type: "uuid", nullable: true);
            migrationBuilder.DropIndex(name: "ix_review_routes_tenant_id_name", table: "review_routes");
            migrationBuilder.CreateIndex(name: "ix_review_routes_project_id", table: "review_routes", column: "project_id");
            migrationBuilder.CreateIndex(name: "ix_review_routes_tenant_id_project_id_name", table: "review_routes",
                columns: ["tenant_id", "project_id", "name"], unique: true).Annotation("Npgsql:NullsDistinct", false);
            migrationBuilder.AddForeignKey(name: "fk_review_routes_projects_project_id", table: "review_routes", column: "project_id",
                principalTable: "projects", principalColumn: "id", onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "fk_review_routes_projects_project_id", table: "review_routes");
            migrationBuilder.DropIndex(name: "ix_review_routes_project_id", table: "review_routes");
            migrationBuilder.DropIndex(name: "ix_review_routes_tenant_id_project_id_name", table: "review_routes");
            migrationBuilder.DropColumn(name: "project_id", table: "review_routes");
            migrationBuilder.CreateIndex(name: "ix_review_routes_tenant_id_name", table: "review_routes", columns: ["tenant_id", "name"], unique: true);
        }
    }
}
