using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// A linked account's own function at home (shown "ACME / Lead Engineer"), and claims of an entry by the organization it
    /// is: confirmed by the guest that stood for it, by email, or vouched for by the organization that made it.
    /// </summary>
    public partial class OrganizationClaims : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "home_function", table: "users", type: "character varying(200)", maxLength: 200, nullable: true);
            migrationBuilder.CreateTable(
                name: "organization_claims",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    entry_id = table.Column<Guid>(type: "uuid", nullable: false),
                    claimer_tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    claimer_identity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    claimed_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    method = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    sent_to = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    maker_tenant_id = table.Column<Guid>(type: "uuid", nullable: true),
                    state = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    answered_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    answered_by_name = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    refused_why = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table => table.PrimaryKey("pk_organization_claims", x => x.id));
            migrationBuilder.CreateIndex(name: "ix_organization_claims_entry_id", table: "organization_claims", column: "entry_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "organization_claims");
            migrationBuilder.DropColumn(name: "home_function", table: "users");
        }
    }
}
