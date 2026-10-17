using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// An organization's identifier (country, kind, number) and email domain beside its name; who first listed it; and
    /// merges of duplicates, asked, agreed by each side and carried out by the app's owner. A list may hold two lines for
    /// one organization once they are merged, so a holder is per line.
    /// </summary>
    public partial class OrganizationIdentifiers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "country", table: "organization_identities", type: "character varying(2)", maxLength: 2, nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "created_by_tenant_id", table: "organization_identities", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<string>(name: "domain", table: "organization_identities", type: "character varying(253)", maxLength: 253, nullable: true);
            migrationBuilder.AddColumn<Instant>(name: "domain_confirmed_at", table: "organization_identities", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<Instant>(name: "identifier_changed_at", table: "organization_identities", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<string>(name: "identifier_changed_by_name", table: "organization_identities", type: "character varying(200)", maxLength: 200, nullable: true);
            migrationBuilder.AddColumn<string>(name: "identifier_kind", table: "organization_identities", type: "character varying(16)", maxLength: 16, nullable: true);
            migrationBuilder.AddColumn<string>(name: "identifier_number", table: "organization_identities", type: "character varying(64)", maxLength: 64, nullable: true);
            migrationBuilder.AddColumn<Instant>(name: "merged_at", table: "organization_identities", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "merged_into_id", table: "organization_identities", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<string>(name: "no_identifier_reason", table: "organization_identities", type: "character varying(2000)", maxLength: 2000, nullable: true);
            migrationBuilder.AddColumn<string>(name: "previous_identifier", table: "organization_identities", type: "character varying(100)", maxLength: 100, nullable: true);
            migrationBuilder.CreateIndex(name: "ix_organization_identities_domain", table: "organization_identities", column: "domain");
            // Who first listed each: the organization of its code's reservation.
            migrationBuilder.Sql("UPDATE organization_identities o SET created_by_tenant_id = r.tenant_id FROM reserved_values r WHERE r.kind = 'ORG_CODE' AND r.holder_id = o.id AND o.created_by_tenant_id IS NULL;");

            migrationBuilder.DropPrimaryKey(name: "pk_organization_holders", table: "organization_holders");
            migrationBuilder.AddPrimaryKey(name: "pk_organization_holders", table: "organization_holders", columns: new[] { "organization_id", "tenant_id", "party_id" });

            migrationBuilder.CreateTable(
                name: "organization_merges",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    keep_id = table.Column<Guid>(type: "uuid", nullable: false),
                    merge_id = table.Column<Guid>(type: "uuid", nullable: false),
                    requested_by_tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    requested_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    why = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    requested_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    agreed_tenant_ids = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    state = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    refused_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    refused_why = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    answered_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    done_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table => table.PrimaryKey("pk_organization_merges", x => x.id));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "organization_merges");
            migrationBuilder.DropPrimaryKey(name: "pk_organization_holders", table: "organization_holders");
            migrationBuilder.AddPrimaryKey(name: "pk_organization_holders", table: "organization_holders", columns: new[] { "organization_id", "tenant_id" });
            migrationBuilder.DropIndex(name: "ix_organization_identities_domain", table: "organization_identities");
            foreach (var column in new[] { "country", "created_by_tenant_id", "domain", "domain_confirmed_at", "identifier_changed_at",
                "identifier_changed_by_name", "identifier_kind", "identifier_number", "merged_at", "merged_into_id", "no_identifier_reason", "previous_identifier" })
                migrationBuilder.DropColumn(name: column, table: "organization_identities");
        }
    }
}
