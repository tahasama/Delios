using System;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class Checks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "check_opt_outs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    check_id = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_check_opt_outs", x => x.id);
                    table.ForeignKey(
                        name: "fk_check_opt_outs_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_check_opt_outs_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "check_runs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    requested_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    requested_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    started_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    finished_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    executed = table.Column<int>(type: "integer", nullable: false),
                    passed = table.Column<int>(type: "integer", nullable: false),
                    failed = table.Column<int>(type: "integer", nullable: false),
                    needs_setup = table.Column<int>(type: "integer", nullable: false),
                    off = table.Column<int>(type: "integer", nullable: false),
                    integrity = table.Column<decimal>(type: "numeric(5,1)", precision: 5, scale: 1, nullable: false),
                    coverage = table.Column<decimal>(type: "numeric(5,1)", precision: 5, scale: 1, nullable: false),
                    open_critical = table.Column<int>(type: "integer", nullable: false),
                    error = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    results = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_check_runs", x => x.id);
                    table.ForeignKey(
                        name: "fk_check_runs_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_check_runs_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "defects",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    check_id = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    severity = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    owner = table.Column<string>(type: "character varying(4)", maxLength: 4, nullable: false),
                    entity_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    entity_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: true),
                    document_id = table.Column<Guid>(type: "uuid", nullable: true),
                    label = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    first_seen_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    last_seen_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    closed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    accepted_reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    accepted_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    accepted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_defects", x => x.id);
                    table.ForeignKey(
                        name: "fk_defects_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_defects_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_check_opt_outs_project_id_check_id",
                table: "check_opt_outs",
                columns: new[] { "project_id", "check_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_check_opt_outs_tenant_id",
                table: "check_opt_outs",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_check_runs_project_id_requested_at",
                table: "check_runs",
                columns: new[] { "project_id", "requested_at" });

            migrationBuilder.CreateIndex(
                name: "ix_check_runs_tenant_id",
                table: "check_runs",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_defects_document_id",
                table: "defects",
                column: "document_id");

            migrationBuilder.CreateIndex(
                name: "ix_defects_project_id_check_id_entity_key",
                table: "defects",
                columns: new[] { "project_id", "check_id", "entity_key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_defects_project_id_status_severity",
                table: "defects",
                columns: new[] { "project_id", "status", "severity" });

            migrationBuilder.CreateIndex(
                name: "ix_defects_tenant_id",
                table: "defects",
                column: "tenant_id");

            RowLevelSecurity.Enable(migrationBuilder, "check_runs", "defects", "check_opt_outs");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            RowLevelSecurity.Disable(migrationBuilder, "check_runs", "defects", "check_opt_outs");

            migrationBuilder.DropTable(
                name: "check_opt_outs");

            migrationBuilder.DropTable(
                name: "check_runs");

            migrationBuilder.DropTable(
                name: "defects");
        }
    }
}
