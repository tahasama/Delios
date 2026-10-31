using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class ReportCounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "report_counts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    report_id = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    asked = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    audience = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    body = table.Column<string>(type: "text", nullable: false),
                    counted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    counted_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_report_counts", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_report_counts_project_id_report_id_asked_audience",
                table: "report_counts",
                columns: new[] { "project_id", "report_id", "asked", "audience" },
                unique: true);

            Delios.Host.Tenancy.RowLevelSecurity.Enable(migrationBuilder, "report_counts");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "report_counts");
        }
    }
}
