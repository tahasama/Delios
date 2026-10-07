using System;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class Packages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "package_id",
                table: "transmittals",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "packages",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    description = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    reason = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    required_statuses = table.Column<string[]>(type: "text[]", nullable: false),
                    completion_date = table.Column<LocalDate>(type: "date", nullable: true),
                    excluded = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    recipient_party_ids = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    owner_ids = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    acceptor_ids = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    state = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    assessed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    shortfall_issued_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    shortfall_accepted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    shortfall_accepted_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    rule_ceased_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    closed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    closed_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    closure_note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    accepted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    accepted_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    rule = table.Column<string>(type: "jsonb", nullable: true),
                    shortfall = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_packages", x => x.id);
                    table.ForeignKey(
                        name: "fk_packages_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_packages_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "package_members",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    package_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    required_statuses = table.Column<string[]>(type: "text[]", nullable: false),
                    by_rule = table.Column<bool>(type: "boolean", nullable: false),
                    added_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_package_members", x => x.id);
                    table.ForeignKey(
                        name: "fk_package_members_documents_document_id",
                        column: x => x.document_id,
                        principalTable: "documents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_package_members_packages_package_id",
                        column: x => x.package_id,
                        principalTable: "packages",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_package_members_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_transmittals_package_id",
                table: "transmittals",
                column: "package_id");

            migrationBuilder.CreateIndex(
                name: "ix_package_members_document_id",
                table: "package_members",
                column: "document_id");

            migrationBuilder.CreateIndex(
                name: "ix_package_members_package_id_document_id",
                table: "package_members",
                columns: new[] { "package_id", "document_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_package_members_tenant_id",
                table: "package_members",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_packages_project_id_number",
                table: "packages",
                columns: new[] { "project_id", "number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_packages_project_id_state",
                table: "packages",
                columns: new[] { "project_id", "state" });

            migrationBuilder.CreateIndex(
                name: "ix_packages_tenant_id",
                table: "packages",
                column: "tenant_id");

            migrationBuilder.AddForeignKey(
                name: "fk_transmittals_packages_package_id",
                table: "transmittals",
                column: "package_id",
                principalTable: "packages",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            RowLevelSecurity.Enable(migrationBuilder, "packages", "package_members");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            RowLevelSecurity.Disable(migrationBuilder, "packages", "package_members");

            migrationBuilder.DropForeignKey(
                name: "fk_transmittals_packages_package_id",
                table: "transmittals");

            migrationBuilder.DropTable(
                name: "package_members");

            migrationBuilder.DropTable(
                name: "packages");

            migrationBuilder.DropIndex(
                name: "ix_transmittals_package_id",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "package_id",
                table: "transmittals");
        }
    }
}
