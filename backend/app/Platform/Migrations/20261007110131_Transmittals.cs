using System;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class Transmittals : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "function_code",
                table: "review_steps",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32);

            migrationBuilder.AddColumn<string>(
                name: "dispatch_channel",
                table: "review_steps",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "dispatch_ref",
                table: "review_steps",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "dispatched_at",
                table: "review_steps",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "dispatched_by_name",
                table: "review_steps",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "evidence_file_id",
                table: "review_steps",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "foreign_answer",
                table: "review_steps",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "participation",
                table: "review_steps",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "party_id",
                table: "review_steps",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "party_name",
                table: "review_steps",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "reason",
                table: "review_steps",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "recorded_by_name",
                table: "review_steps",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "transmittal_id",
                table: "review_steps",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "custodian_function",
                table: "parties",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "evidence_required",
                table: "parties",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "external_system",
                table: "parties",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "participation",
                table: "parties",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "IN_APP");

            migrationBuilder.CreateTable(
                name: "issue_requests",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    revision_id = table.Column<Guid>(type: "uuid", nullable: false),
                    reason = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    user_ids = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    party_ids = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    off_distribution_reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    raised_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    raised_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    raised_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    closed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    closed_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_issue_requests", x => x.id);
                    table.ForeignKey(
                        name: "fk_issue_requests_documents_document_id",
                        column: x => x.document_id,
                        principalTable: "documents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_issue_requests_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_issue_requests_revisions_revision_id",
                        column: x => x.revision_id,
                        principalTable: "revisions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_issue_requests_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "transmittals",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    direction = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    reason = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    subject = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    message = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    to_party_id = table.Column<Guid>(type: "uuid", nullable: true),
                    to_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    response_required = table.Column<bool>(type: "boolean", nullable: false),
                    response_due = table.Column<LocalDate>(type: "date", nullable: true),
                    issued_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    issued_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    issued_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    issue_request_id = table.Column<Guid>(type: "uuid", nullable: true),
                    review_step_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_transmittals", x => x.id);
                    table.ForeignKey(
                        name: "fk_transmittals_issue_requests_issue_request_id",
                        column: x => x.issue_request_id,
                        principalTable: "issue_requests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transmittals_parties_to_party_id",
                        column: x => x.to_party_id,
                        principalTable: "parties",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transmittals_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transmittals_review_steps_review_step_id",
                        column: x => x.review_step_id,
                        principalTable: "review_steps",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transmittals_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "transmittal_items",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    transmittal_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    revision_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_number = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    revision_value = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    status_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_transmittal_items", x => x.id);
                    table.ForeignKey(
                        name: "fk_transmittal_items_documents_document_id",
                        column: x => x.document_id,
                        principalTable: "documents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transmittal_items_revisions_revision_id",
                        column: x => x.revision_id,
                        principalTable: "revisions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transmittal_items_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transmittal_items_transmittals_transmittal_id",
                        column: x => x.transmittal_id,
                        principalTable: "transmittals",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "transmittal_recipients",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    transmittal_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    party_id = table.Column<Guid>(type: "uuid", nullable: true),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    organization = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    opened_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    acknowledged_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    dispatched_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    dispatch_channel = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    dispatch_ref = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    dispatched_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    proof_file_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_transmittal_recipients", x => x.id);
                    table.ForeignKey(
                        name: "fk_transmittal_recipients_parties_party_id",
                        column: x => x.party_id,
                        principalTable: "parties",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transmittal_recipients_stored_files_proof_file_id",
                        column: x => x.proof_file_id,
                        principalTable: "stored_files",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transmittal_recipients_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transmittal_recipients_transmittals_transmittal_id",
                        column: x => x.transmittal_id,
                        principalTable: "transmittals",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transmittal_recipients_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_review_steps_evidence_file_id",
                table: "review_steps",
                column: "evidence_file_id");

            migrationBuilder.CreateIndex(
                name: "ix_review_steps_party_id",
                table: "review_steps",
                column: "party_id");

            migrationBuilder.CreateIndex(
                name: "ix_issue_requests_document_id",
                table: "issue_requests",
                column: "document_id");

            migrationBuilder.CreateIndex(
                name: "ix_issue_requests_project_id_status",
                table: "issue_requests",
                columns: new[] { "project_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_issue_requests_revision_id_status",
                table: "issue_requests",
                columns: new[] { "revision_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_issue_requests_tenant_id",
                table: "issue_requests",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_transmittal_items_document_id",
                table: "transmittal_items",
                column: "document_id");

            migrationBuilder.CreateIndex(
                name: "ix_transmittal_items_revision_id",
                table: "transmittal_items",
                column: "revision_id");

            migrationBuilder.CreateIndex(
                name: "ix_transmittal_items_tenant_id",
                table: "transmittal_items",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_transmittal_items_transmittal_id",
                table: "transmittal_items",
                column: "transmittal_id");

            migrationBuilder.CreateIndex(
                name: "ix_transmittal_recipients_party_id_dispatched_at",
                table: "transmittal_recipients",
                columns: new[] { "party_id", "dispatched_at" });

            migrationBuilder.CreateIndex(
                name: "ix_transmittal_recipients_proof_file_id",
                table: "transmittal_recipients",
                column: "proof_file_id");

            migrationBuilder.CreateIndex(
                name: "ix_transmittal_recipients_tenant_id",
                table: "transmittal_recipients",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_transmittal_recipients_transmittal_id",
                table: "transmittal_recipients",
                column: "transmittal_id");

            migrationBuilder.CreateIndex(
                name: "ix_transmittal_recipients_user_id_acknowledged_at",
                table: "transmittal_recipients",
                columns: new[] { "user_id", "acknowledged_at" });

            migrationBuilder.CreateIndex(
                name: "ix_transmittals_issue_request_id",
                table: "transmittals",
                column: "issue_request_id");

            migrationBuilder.CreateIndex(
                name: "ix_transmittals_project_id_issued_at",
                table: "transmittals",
                columns: new[] { "project_id", "issued_at" });

            migrationBuilder.CreateIndex(
                name: "ix_transmittals_project_id_number",
                table: "transmittals",
                columns: new[] { "project_id", "number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_transmittals_review_step_id",
                table: "transmittals",
                column: "review_step_id");

            migrationBuilder.CreateIndex(
                name: "ix_transmittals_tenant_id",
                table: "transmittals",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_transmittals_to_party_id",
                table: "transmittals",
                column: "to_party_id");

            migrationBuilder.AddForeignKey(
                name: "fk_review_steps_parties_party_id",
                table: "review_steps",
                column: "party_id",
                principalTable: "parties",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_review_steps_stored_files_evidence_file_id",
                table: "review_steps",
                column: "evidence_file_id",
                principalTable: "stored_files",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            RowLevelSecurity.Enable(migrationBuilder, "issue_requests", "transmittals", "transmittal_items", "transmittal_recipients");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            RowLevelSecurity.Disable(migrationBuilder, "issue_requests", "transmittals", "transmittal_items", "transmittal_recipients");

            migrationBuilder.DropForeignKey(
                name: "fk_review_steps_parties_party_id",
                table: "review_steps");

            migrationBuilder.DropForeignKey(
                name: "fk_review_steps_stored_files_evidence_file_id",
                table: "review_steps");

            migrationBuilder.DropTable(
                name: "transmittal_items");

            migrationBuilder.DropTable(
                name: "transmittal_recipients");

            migrationBuilder.DropTable(
                name: "transmittals");

            migrationBuilder.DropTable(
                name: "issue_requests");

            migrationBuilder.DropIndex(
                name: "ix_review_steps_evidence_file_id",
                table: "review_steps");

            migrationBuilder.DropIndex(
                name: "ix_review_steps_party_id",
                table: "review_steps");

            migrationBuilder.DropColumn(
                name: "dispatch_channel",
                table: "review_steps");

            migrationBuilder.DropColumn(
                name: "dispatch_ref",
                table: "review_steps");

            migrationBuilder.DropColumn(
                name: "dispatched_at",
                table: "review_steps");

            migrationBuilder.DropColumn(
                name: "dispatched_by_name",
                table: "review_steps");

            migrationBuilder.DropColumn(
                name: "evidence_file_id",
                table: "review_steps");

            migrationBuilder.DropColumn(
                name: "foreign_answer",
                table: "review_steps");

            migrationBuilder.DropColumn(
                name: "participation",
                table: "review_steps");

            migrationBuilder.DropColumn(
                name: "party_id",
                table: "review_steps");

            migrationBuilder.DropColumn(
                name: "party_name",
                table: "review_steps");

            migrationBuilder.DropColumn(
                name: "reason",
                table: "review_steps");

            migrationBuilder.DropColumn(
                name: "recorded_by_name",
                table: "review_steps");

            migrationBuilder.DropColumn(
                name: "transmittal_id",
                table: "review_steps");

            migrationBuilder.DropColumn(
                name: "custodian_function",
                table: "parties");

            migrationBuilder.DropColumn(
                name: "evidence_required",
                table: "parties");

            migrationBuilder.DropColumn(
                name: "external_system",
                table: "parties");

            migrationBuilder.DropColumn(
                name: "participation",
                table: "parties");

            migrationBuilder.AlterColumn<string>(
                name: "function_code",
                table: "review_steps",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32,
                oldNullable: true);
        }
    }
}
