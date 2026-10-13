using System;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class ContentExtraction : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "content_extraction",
                table: "projects",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "OFF");

            migrationBuilder.CreateTable(
                name: "file_texts",
                columns: table => new
                {
                    file_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    revision_id = table.Column<Guid>(type: "uuid", nullable: true),
                    text = table.Column<string>(type: "text", nullable: false),
                    chars = table.Column<int>(type: "integer", nullable: false),
                    truncated = table.Column<bool>(type: "boolean", nullable: false),
                    extracted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_file_texts", x => x.file_id);
                    table.ForeignKey(
                        name: "fk_file_texts_stored_files_file_id",
                        column: x => x.file_id,
                        principalTable: "stored_files",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_file_texts_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_file_texts_document_id",
                table: "file_texts",
                column: "document_id");

            migrationBuilder.CreateIndex(
                name: "ix_file_texts_project_id",
                table: "file_texts",
                column: "project_id");

            migrationBuilder.CreateIndex(
                name: "ix_file_texts_revision_id",
                table: "file_texts",
                column: "revision_id");

            migrationBuilder.CreateIndex(
                name: "ix_file_texts_tenant_id",
                table: "file_texts",
                column: "tenant_id");

            RowLevelSecurity.Enable(migrationBuilder, "file_texts");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            RowLevelSecurity.Disable(migrationBuilder, "file_texts");

            migrationBuilder.DropTable(
                name: "file_texts");

            migrationBuilder.DropColumn(
                name: "content_extraction",
                table: "projects");
        }
    }
}
