using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class ListSources : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "list_sources",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    document_id = table.Column<Guid>(type: "uuid", nullable: true),
                    chosen_by_name = table.Column<string>(type: "text", nullable: true),
                    chosen_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    last_from = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    last_revision_id = table.Column<Guid>(type: "uuid", nullable: true),
                    last_label = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    last_by_name = table.Column<string>(type: "text", nullable: true),
                    last_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_list_sources", x => x.id);
                    table.ForeignKey(
                        name: "fk_list_sources_documents_document_id",
                        column: x => x.document_id,
                        principalTable: "documents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_list_sources_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_list_sources_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_list_sources_document_id",
                table: "list_sources",
                column: "document_id");

            migrationBuilder.CreateIndex(
                name: "ix_list_sources_project_id_kind",
                table: "list_sources",
                columns: new[] { "project_id", "kind" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_list_sources_tenant_id",
                table: "list_sources",
                column: "tenant_id");

            Delios.Host.Tenancy.RowLevelSecurity.Enable(migrationBuilder, "list_sources");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "list_sources");
        }
    }
}
