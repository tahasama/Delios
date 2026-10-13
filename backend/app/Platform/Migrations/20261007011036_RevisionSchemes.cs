using System;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class RevisionSchemes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "revision_schemes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    is_default = table.Column<bool>(type: "boolean", nullable: false),
                    forward_only = table.Column<bool>(type: "boolean", nullable: false),
                    series = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_revision_schemes", x => x.id);
                    table.ForeignKey(
                        name: "fk_revision_schemes_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "revision_scheme_routings",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    deliverable_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    scheme_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_revision_scheme_routings", x => x.id);
                    table.ForeignKey(
                        name: "fk_revision_scheme_routings_revision_schemes_scheme_id",
                        column: x => x.scheme_id,
                        principalTable: "revision_schemes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_revision_scheme_routings_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_revision_scheme_routings_scheme_id",
                table: "revision_scheme_routings",
                column: "scheme_id");

            migrationBuilder.CreateIndex(
                name: "ix_revision_scheme_routings_tenant_id_deliverable_type",
                table: "revision_scheme_routings",
                columns: new[] { "tenant_id", "deliverable_type" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_revision_schemes_one_default",
                table: "revision_schemes",
                column: "tenant_id",
                unique: true,
                filter: "is_default");

            migrationBuilder.CreateIndex(
                name: "ix_revision_schemes_tenant_id_name",
                table: "revision_schemes",
                columns: new[] { "tenant_id", "name" },
                unique: true);

            RowLevelSecurity.Enable(migrationBuilder, "revision_schemes", "revision_scheme_routings");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            RowLevelSecurity.Disable(migrationBuilder, "revision_schemes", "revision_scheme_routings");
            migrationBuilder.DropTable(
                name: "revision_scheme_routings");

            migrationBuilder.DropTable(
                name: "revision_schemes");
        }
    }
}
