using System;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class Schedules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "activities",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    start = table.Column<LocalDate>(type: "date", nullable: true),
                    finish = table.Column<LocalDate>(type: "date", nullable: true),
                    responsible = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    departments = table.Column<string[]>(type: "text[]", nullable: false),
                    state = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    source_revision_id = table.Column<Guid>(type: "uuid", nullable: true),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    need_count = table.Column<int>(type: "integer", nullable: false),
                    met_count = table.Column<int>(type: "integer", nullable: false),
                    waived_count = table.Column<int>(type: "integer", nullable: false),
                    next_needed_by = table.Column<LocalDate>(type: "date", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_activities", x => x.id);
                    table.ForeignKey(
                        name: "fk_activities_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_activities_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "schedule_imports",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    revision_id = table.Column<Guid>(type: "uuid", nullable: false),
                    revision_value = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    file_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    error = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    imported_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    added = table.Column<int>(type: "integer", nullable: false),
                    moved = table.Column<int>(type: "integer", nullable: false),
                    changed = table.Column<int>(type: "integer", nullable: false),
                    removed = table.Column<int>(type: "integer", nullable: false),
                    unchanged = table.Column<int>(type: "integer", nullable: false),
                    changes = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_schedule_imports", x => x.id);
                    table.ForeignKey(
                        name: "fk_schedule_imports_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_schedule_imports_revisions_revision_id",
                        column: x => x.revision_id,
                        principalTable: "revisions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_schedule_imports_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "schedule_sources",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    default_lead_days = table.Column<int>(type: "integer", nullable: false),
                    risk_window_days = table.Column<int>(type: "integer", nullable: false),
                    columns = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_schedule_sources", x => x.id);
                    table.ForeignKey(
                        name: "fk_schedule_sources_documents_document_id",
                        column: x => x.document_id,
                        principalTable: "documents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_schedule_sources_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_schedule_sources_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "activity_decisions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    activity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    decision = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    planned_start = table.Column<LocalDate>(type: "date", nullable: true),
                    responsible_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    delay_owed_by = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    delay_reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    recorded_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    recorded_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_activity_decisions", x => x.id);
                    table.ForeignKey(
                        name: "fk_activity_decisions_activities_activity_id",
                        column: x => x.activity_id,
                        principalTable: "activities",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_activity_decisions_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "requirements",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    activity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    purpose = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    required_statuses = table.Column<string[]>(type: "text[]", nullable: false),
                    anchor = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    offset_days = table.Column<int>(type: "integer", nullable: false),
                    fixed_date = table.Column<LocalDate>(type: "date", nullable: true),
                    needed_by = table.Column<LocalDate>(type: "date", nullable: true),
                    department = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    state = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    met_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    waiver_note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    waived_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    waived_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    created_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_requirements", x => x.id);
                    table.ForeignKey(
                        name: "fk_requirements_activities_activity_id",
                        column: x => x.activity_id,
                        principalTable: "activities",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_requirements_documents_document_id",
                        column: x => x.document_id,
                        principalTable: "documents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_requirements_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_activities_project_id_code",
                table: "activities",
                columns: new[] { "project_id", "code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_activities_project_id_next_needed_by",
                table: "activities",
                columns: new[] { "project_id", "next_needed_by" });

            migrationBuilder.CreateIndex(
                name: "ix_activities_project_id_start",
                table: "activities",
                columns: new[] { "project_id", "start" });

            migrationBuilder.CreateIndex(
                name: "ix_activities_tenant_id",
                table: "activities",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_activity_decisions_activity_id",
                table: "activity_decisions",
                column: "activity_id");

            migrationBuilder.CreateIndex(
                name: "ix_activity_decisions_tenant_id",
                table: "activity_decisions",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_requirements_activity_id_document_id_purpose",
                table: "requirements",
                columns: new[] { "activity_id", "document_id", "purpose" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_requirements_document_id",
                table: "requirements",
                column: "document_id");

            migrationBuilder.CreateIndex(
                name: "ix_requirements_project_id_state_needed_by",
                table: "requirements",
                columns: new[] { "project_id", "state", "needed_by" });

            migrationBuilder.CreateIndex(
                name: "ix_requirements_tenant_id",
                table: "requirements",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_imports_project_id_imported_at",
                table: "schedule_imports",
                columns: new[] { "project_id", "imported_at" });

            migrationBuilder.CreateIndex(
                name: "ix_schedule_imports_revision_id",
                table: "schedule_imports",
                column: "revision_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_schedule_imports_tenant_id",
                table: "schedule_imports",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_sources_document_id",
                table: "schedule_sources",
                column: "document_id");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_sources_project_id",
                table: "schedule_sources",
                column: "project_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_schedule_sources_tenant_id",
                table: "schedule_sources",
                column: "tenant_id");

            RowLevelSecurity.Enable(migrationBuilder, "schedule_sources", "schedule_imports", "activities", "requirements", "activity_decisions");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            RowLevelSecurity.Disable(migrationBuilder, "schedule_sources", "schedule_imports", "activities", "requirements", "activity_decisions");

            migrationBuilder.DropTable(
                name: "activity_decisions");

            migrationBuilder.DropTable(
                name: "requirements");

            migrationBuilder.DropTable(
                name: "schedule_imports");

            migrationBuilder.DropTable(
                name: "schedule_sources");

            migrationBuilder.DropTable(
                name: "activities");
        }
    }
}
