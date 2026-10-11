using Delios.Host.Tenancy;
﻿using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class ActionConfirmations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "risk_days",
                table: "requirements",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "automatic",
                table: "readiness_confirmations",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Instant>(
                name: "revoked_at",
                table: "readiness_confirmations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "revoked_by_name",
                table: "readiness_confirmations",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "revoked_reason",
                table: "readiness_confirmations",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "confirm_note",
                table: "activity_decisions",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "confirmed_at",
                table: "activity_decisions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "confirmed_by_name",
                table: "activity_decisions",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "reversed_at",
                table: "activity_decisions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "reversed_by_name",
                table: "activity_decisions",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "reversed_reason",
                table: "activity_decisions",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<LocalDate>(
                name: "risk_from",
                table: "activities",
                type: "date",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "notices",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    subject = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    automatic = table.Column<bool>(type: "boolean", nullable: false),
                    title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    body = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    recipient_ids = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    recipient_names = table.Column<string[]>(type: "text[]", nullable: false),
                    sent_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    sent_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notices", x => x.id);
                    table.ForeignKey(
                        name: "fk_notices_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_notices_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_notices_project_id_subject_sent_at",
                table: "notices",
                columns: new[] { "project_id", "subject", "sent_at" });

            migrationBuilder.CreateIndex(
                name: "ix_notices_tenant_id",
                table: "notices",
                column: "tenant_id");
            RowLevelSecurity.Enable(migrationBuilder, "notices");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            RowLevelSecurity.Disable(migrationBuilder, "notices");
            migrationBuilder.DropTable(
                name: "notices");

            migrationBuilder.DropColumn(
                name: "risk_days",
                table: "requirements");

            migrationBuilder.DropColumn(
                name: "automatic",
                table: "readiness_confirmations");

            migrationBuilder.DropColumn(
                name: "revoked_at",
                table: "readiness_confirmations");

            migrationBuilder.DropColumn(
                name: "revoked_by_name",
                table: "readiness_confirmations");

            migrationBuilder.DropColumn(
                name: "revoked_reason",
                table: "readiness_confirmations");

            migrationBuilder.DropColumn(
                name: "confirm_note",
                table: "activity_decisions");

            migrationBuilder.DropColumn(
                name: "confirmed_at",
                table: "activity_decisions");

            migrationBuilder.DropColumn(
                name: "confirmed_by_name",
                table: "activity_decisions");

            migrationBuilder.DropColumn(
                name: "reversed_at",
                table: "activity_decisions");

            migrationBuilder.DropColumn(
                name: "reversed_by_name",
                table: "activity_decisions");

            migrationBuilder.DropColumn(
                name: "reversed_reason",
                table: "activity_decisions");

            migrationBuilder.DropColumn(
                name: "risk_from",
                table: "activities");
        }
    }
}
