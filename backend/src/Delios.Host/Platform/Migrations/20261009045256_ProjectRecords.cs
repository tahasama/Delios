using System;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class ProjectRecords : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "assets",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    area = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    system = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    unit = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    extras = table.Column<string>(type: "jsonb", nullable: true),
                    active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_assets", x => x.id);
                    table.ForeignKey(
                        name: "fk_assets_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "controlled_versions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    kind = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    key = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    version_label = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    state = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    payload = table.Column<string>(type: "jsonb", nullable: false),
                    diff = table.Column<string>(type: "jsonb", nullable: true),
                    row_count = table.Column<int>(type: "integer", nullable: false),
                    source_name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    source_size = table.Column<long>(type: "bigint", nullable: true),
                    source_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    submitted_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    submitted_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    submitted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    decided_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    decided_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    decision_reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    applied_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    applied_summary = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    superseded_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_controlled_versions", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "exception_entries",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    item = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    clauses = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    authority = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    start_date = table.Column<LocalDate>(type: "date", nullable: false),
                    review_point = table.Column<LocalDate>(type: "date", nullable: true),
                    recorded_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_exception_entries", x => x.id);
                    table.ForeignKey(
                        name: "fk_exception_entries_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "number_ranges",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    prefix = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    from = table.Column<int>(type: "integer", nullable: false),
                    to = table.Column<int>(type: "integer", nullable: false),
                    last_issued = table.Column<int>(type: "integer", nullable: false),
                    issued_to = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    issued_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_number_ranges", x => x.id);
                    table.ForeignKey(
                        name: "fk_number_ranges_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "readiness_confirmations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    activity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    department = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    available = table.Column<bool>(type: "boolean", nullable: false),
                    note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    confirmed_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    confirmed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_readiness_confirmations", x => x.id);
                    table.ForeignKey(
                        name: "fk_readiness_confirmations_activities_activity_id",
                        column: x => x.activity_id,
                        principalTable: "activities",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "requirement_calls",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    department = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    activity_codes = table.Column<string[]>(type: "text[]", nullable: false),
                    due_on = table.Column<LocalDate>(type: "date", nullable: false),
                    issued_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    issued_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    reminders = table.Column<int>(type: "integer", nullable: false),
                    last_reminded_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    answered_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    answer_note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_requirement_calls", x => x.id);
                    table.ForeignKey(
                        name: "fk_requirement_calls_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "sender_issues",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    sender = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    entry_count = table.Column<int>(type: "integer", nullable: false),
                    need_ids = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    issued_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    issued_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_sender_issues", x => x.id);
                    table.ForeignKey(
                        name: "fk_sender_issues_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "document_assets",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    asset_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_document_assets", x => x.id);
                    table.ForeignKey(
                        name: "fk_document_assets_assets_asset_id",
                        column: x => x.asset_id,
                        principalTable: "assets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_document_assets_documents_document_id",
                        column: x => x.document_id,
                        principalTable: "documents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_assets_project_id_code",
                table: "assets",
                columns: new[] { "project_id", "code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_controlled_versions_tenant_id_project_id_kind_key_state",
                table: "controlled_versions",
                columns: new[] { "tenant_id", "project_id", "kind", "key", "state" });

            migrationBuilder.CreateIndex(
                name: "ix_controlled_versions_tenant_id_project_id_kind_key_version_l",
                table: "controlled_versions",
                columns: new[] { "tenant_id", "project_id", "kind", "key", "version_label" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "ix_document_assets_asset_id",
                table: "document_assets",
                column: "asset_id");

            migrationBuilder.CreateIndex(
                name: "ix_document_assets_document_id_asset_id",
                table: "document_assets",
                columns: new[] { "document_id", "asset_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_exception_entries_project_id",
                table: "exception_entries",
                column: "project_id");

            migrationBuilder.CreateIndex(
                name: "ix_number_ranges_project_id_prefix",
                table: "number_ranges",
                columns: new[] { "project_id", "prefix" });

            migrationBuilder.CreateIndex(
                name: "ix_readiness_confirmations_activity_id_department",
                table: "readiness_confirmations",
                columns: new[] { "activity_id", "department" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_readiness_confirmations_project_id",
                table: "readiness_confirmations",
                column: "project_id");

            migrationBuilder.CreateIndex(
                name: "ix_requirement_calls_project_id_department",
                table: "requirement_calls",
                columns: new[] { "project_id", "department" });

            migrationBuilder.CreateIndex(
                name: "ix_sender_issues_project_id_sender_issued_at",
                table: "sender_issues",
                columns: new[] { "project_id", "sender", "issued_at" });

            RowLevelSecurity.Enable(migrationBuilder, "assets");
            RowLevelSecurity.Enable(migrationBuilder, "controlled_versions");
            RowLevelSecurity.Enable(migrationBuilder, "exception_entries");
            RowLevelSecurity.Enable(migrationBuilder, "number_ranges");
            RowLevelSecurity.Enable(migrationBuilder, "readiness_confirmations");
            RowLevelSecurity.Enable(migrationBuilder, "requirement_calls");
            RowLevelSecurity.Enable(migrationBuilder, "sender_issues");
            RowLevelSecurity.Enable(migrationBuilder, "document_assets");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "controlled_versions");

            migrationBuilder.DropTable(
                name: "document_assets");

            migrationBuilder.DropTable(
                name: "exception_entries");

            migrationBuilder.DropTable(
                name: "number_ranges");

            migrationBuilder.DropTable(
                name: "readiness_confirmations");

            migrationBuilder.DropTable(
                name: "requirement_calls");

            migrationBuilder.DropTable(
                name: "sender_issues");

            migrationBuilder.DropTable(
                name: "assets");
        }
    }
}
