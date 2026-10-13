using System;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class RecordKeeping : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Instant>(
                name: "held_at",
                table: "revisions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "held_by_name",
                table: "revisions",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "held_reason",
                table: "revisions",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "void_authority",
                table: "revisions",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "void_reason",
                table: "revisions",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "void_reassessed_at",
                table: "revisions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "void_reassessment",
                table: "revisions",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "voided_at",
                table: "revisions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "issue_request_id",
                table: "reviews",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "approval_state",
                table: "issue_requests",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "approver_party_id",
                table: "issue_requests",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "delegated",
                table: "issue_requests",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "app_version",
                table: "documents",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "extras",
                table: "documents",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "legacy_scheme",
                table: "documents",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "legal_hold",
                table: "documents",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Instant>(
                name: "legal_hold_at",
                table: "documents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "legal_hold_by_name",
                table: "documents",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "legal_hold_reason",
                table: "documents",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "previous_number",
                table: "documents",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "added_by_name",
                table: "document_access",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "reason",
                table: "document_access",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "document_snapshots",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    revision_id = table.Column<Guid>(type: "uuid", nullable: true),
                    captured_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    event_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    event_label = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    actor_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    payload = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_document_snapshots", x => x.id);
                    table.ForeignKey(
                        name: "fk_document_snapshots_documents_document_id",
                        column: x => x.document_id,
                        principalTable: "documents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_document_snapshots_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_document_snapshots_document_id_captured_at",
                table: "document_snapshots",
                columns: new[] { "document_id", "captured_at" });

            migrationBuilder.CreateIndex(
                name: "ix_document_snapshots_tenant_id",
                table: "document_snapshots",
                column: "tenant_id");

            RowLevelSecurity.Enable(migrationBuilder, "document_snapshots");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "document_snapshots");

            migrationBuilder.DropColumn(
                name: "held_at",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "held_by_name",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "held_reason",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "void_authority",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "void_reason",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "void_reassessed_at",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "void_reassessment",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "voided_at",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "issue_request_id",
                table: "reviews");

            migrationBuilder.DropColumn(
                name: "approval_state",
                table: "issue_requests");

            migrationBuilder.DropColumn(
                name: "approver_party_id",
                table: "issue_requests");

            migrationBuilder.DropColumn(
                name: "delegated",
                table: "issue_requests");

            migrationBuilder.DropColumn(
                name: "app_version",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "extras",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "legacy_scheme",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "legal_hold",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "legal_hold_at",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "legal_hold_by_name",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "legal_hold_reason",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "previous_number",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "added_by_name",
                table: "document_access");

            migrationBuilder.DropColumn(
                name: "reason",
                table: "document_access");
        }
    }
}
