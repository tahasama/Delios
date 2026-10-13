using System;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class TransmittalThreads : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "extras",
                table: "transmittals",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "follow_kind",
                table: "transmittals",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "follows_id",
                table: "transmittals",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "in_reply_to_id",
                table: "transmittals",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "receipt_note",
                table: "transmittals",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "kind",
                table: "transmittal_recipients",
                type: "character varying(4)",
                maxLength: 4,
                nullable: false,
                defaultValue: "TO");

            migrationBuilder.AddColumn<Instant>(
                name: "last_viewed_at",
                table: "transmittal_recipients",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "notified_at",
                table: "transmittal_recipients",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "view_count",
                table: "transmittal_recipients",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "transmittal_drafts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    subject = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    body = table.Column<string>(type: "jsonb", nullable: false),
                    issued_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    issued_as = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_transmittal_drafts", x => x.id);
                    table.ForeignKey(
                        name: "fk_transmittal_drafts_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transmittal_drafts_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_transmittals_follows_id",
                table: "transmittals",
                column: "follows_id");

            migrationBuilder.CreateIndex(
                name: "ix_transmittals_in_reply_to_id",
                table: "transmittals",
                column: "in_reply_to_id");

            migrationBuilder.CreateIndex(
                name: "ix_transmittal_drafts_project_id_created_by_id",
                table: "transmittal_drafts",
                columns: new[] { "project_id", "created_by_id" });

            migrationBuilder.CreateIndex(
                name: "ix_transmittal_drafts_tenant_id",
                table: "transmittal_drafts",
                column: "tenant_id");

            RowLevelSecurity.Enable(migrationBuilder, "transmittal_drafts");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "transmittal_drafts");

            migrationBuilder.DropIndex(
                name: "ix_transmittals_follows_id",
                table: "transmittals");

            migrationBuilder.DropIndex(
                name: "ix_transmittals_in_reply_to_id",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "extras",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "follow_kind",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "follows_id",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "in_reply_to_id",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "receipt_note",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "kind",
                table: "transmittal_recipients");

            migrationBuilder.DropColumn(
                name: "last_viewed_at",
                table: "transmittal_recipients");

            migrationBuilder.DropColumn(
                name: "notified_at",
                table: "transmittal_recipients");

            migrationBuilder.DropColumn(
                name: "view_count",
                table: "transmittal_recipients");
        }
    }
}
