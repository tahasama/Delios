using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// What is unique across DELIOS (project codes and names, organization codes and names, contract numbers), kept
    /// outside any organization's data; and what may be changed once only (a project's code, an organization's code,
    /// name and how it works with us, a contract number). Filled from what exists by <c>Registry.EnsureAllAsync</c>
    /// after migrating.
    /// </summary>
    public partial class UniqueAcrossDelios : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "reserved_values",
                columns: table => new
                {
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    value = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    shown = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    holder_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    reserved_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table => table.PrimaryKey("pk_reserved_values", x => new { x.kind, x.value }));
            migrationBuilder.CreateIndex(name: "ix_reserved_values_holder_id", table: "reserved_values", column: "holder_id");

            migrationBuilder.CreateTable(
                name: "organization_identities",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    previous_code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    code_changed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    code_changed_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    previous_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    name_changed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    name_changed_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table => table.PrimaryKey("pk_organization_identities", x => x.id));
            migrationBuilder.CreateIndex(name: "ix_organization_identities_code", table: "organization_identities", column: "code", unique: true);

            migrationBuilder.CreateTable(
                name: "organization_holders",
                columns: table => new
                {
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    party_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table => table.PrimaryKey("pk_organization_holders", x => new { x.organization_id, x.tenant_id }));

            migrationBuilder.AddColumn<Guid>(name: "organization_id", table: "parties", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<string>(name: "previous_participation", table: "parties", type: "character varying(16)", maxLength: 16, nullable: true);
            migrationBuilder.AddColumn<Instant>(name: "participation_changed_at", table: "parties", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<string>(name: "participation_changed_by_name", table: "parties", type: "character varying(200)", maxLength: 200, nullable: true);
            migrationBuilder.CreateIndex(name: "ix_parties_organization_id", table: "parties", column: "organization_id");

            migrationBuilder.AddColumn<string>(name: "previous_code", table: "projects", type: "character varying(32)", maxLength: 32, nullable: true);
            migrationBuilder.AddColumn<Instant>(name: "code_changed_at", table: "projects", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<string>(name: "code_changed_by_name", table: "projects", type: "character varying(200)", maxLength: 200, nullable: true);

            migrationBuilder.AddColumn<string>(name: "contract_number", table: "project_parties", type: "character varying(64)", maxLength: 64, nullable: true);
            migrationBuilder.AddColumn<string>(name: "previous_contract_number", table: "project_parties", type: "character varying(64)", maxLength: 64, nullable: true);
            migrationBuilder.AddColumn<Instant>(name: "contract_changed_at", table: "project_parties", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<string>(name: "contract_changed_by_name", table: "project_parties", type: "character varying(200)", maxLength: 200, nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "reserved_values");
            migrationBuilder.DropTable(name: "organization_identities");
            migrationBuilder.DropTable(name: "organization_holders");
            migrationBuilder.DropIndex(name: "ix_parties_organization_id", table: "parties");
            migrationBuilder.DropColumn(name: "organization_id", table: "parties");
            migrationBuilder.DropColumn(name: "previous_participation", table: "parties");
            migrationBuilder.DropColumn(name: "participation_changed_at", table: "parties");
            migrationBuilder.DropColumn(name: "participation_changed_by_name", table: "parties");
            migrationBuilder.DropColumn(name: "previous_code", table: "projects");
            migrationBuilder.DropColumn(name: "code_changed_at", table: "projects");
            migrationBuilder.DropColumn(name: "code_changed_by_name", table: "projects");
            migrationBuilder.DropColumn(name: "contract_number", table: "project_parties");
            migrationBuilder.DropColumn(name: "previous_contract_number", table: "project_parties");
            migrationBuilder.DropColumn(name: "contract_changed_at", table: "project_parties");
            migrationBuilder.DropColumn(name: "contract_changed_by_name", table: "project_parties");
        }
    }
}
