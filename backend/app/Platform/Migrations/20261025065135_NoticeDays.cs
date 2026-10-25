using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class NoticeDays : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<LocalDate>(
                name: "warn_on",
                table: "review_steps",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<LocalDate>(
                name: "notice_on",
                table: "activities",
                type: "date",
                nullable: true);

            // No row-level security, as reserved_values: it holds no content, only when each project's notices go,
            // read in one question by the worker's alarm across every organization.
            migrationBuilder.CreateTable(
                name: "notice_alarms",
                columns: table => new
                {
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    due_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    last_run = table.Column<LocalDate>(type: "date", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notice_alarms", x => x.project_id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_review_steps_warn_on",
                table: "review_steps",
                column: "warn_on");

            migrationBuilder.CreateIndex(
                name: "ix_activities_project_id_notice_on",
                table: "activities",
                columns: new[] { "project_id", "notice_on" });

            migrationBuilder.CreateIndex(
                name: "ix_notice_alarms_due_at",
                table: "notice_alarms",
                column: "due_at");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "notice_alarms");

            migrationBuilder.DropIndex(
                name: "ix_review_steps_warn_on",
                table: "review_steps");

            migrationBuilder.DropIndex(
                name: "ix_activities_project_id_notice_on",
                table: "activities");

            migrationBuilder.DropColumn(
                name: "warn_on",
                table: "review_steps");

            migrationBuilder.DropColumn(
                name: "notice_on",
                table: "activities");
        }
    }
}
