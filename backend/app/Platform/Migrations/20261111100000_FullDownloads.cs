using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>The full download (owner): one zip of an organization's or a project's files, made in the background.</summary>
    public partial class FullDownloads : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "full_downloads",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    scope = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    requested_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    requested_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    requested_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    layout = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    levels = table.Column<string[]>(type: "text[]", nullable: false),
                    with_register = table.Column<bool>(type: "boolean", nullable: false),
                    with_reviews = table.Column<bool>(type: "boolean", nullable: false),
                    with_transmittals = table.Column<bool>(type: "boolean", nullable: false),
                    with_audit = table.Column<bool>(type: "boolean", nullable: false),
                    project_ids = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    left_out = table.Column<string[]>(type: "text[]", nullable: false),
                    document_ids = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    transmittal_ids = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    started_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    finished_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    object_key = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    size = table.Column<long>(type: "bigint", nullable: true),
                    file_count = table.Column<int>(type: "integer", nullable: true),
                    error = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_full_downloads", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_full_downloads_tenant_id_requested_by_id_requested_at",
                table: "full_downloads",
                columns: new[] { "tenant_id", "requested_by_id", "requested_at" });

            Delios.Host.Tenancy.RowLevelSecurity.Enable(migrationBuilder, "full_downloads");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "full_downloads");
        }
    }
}
