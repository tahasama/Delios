using System;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class RepliesByEmail : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "contact_email",
                table: "parties",
                type: "character varying(254)",
                maxLength: 254,
                nullable: true);

            migrationBuilder.AddColumn<Guid[]>(
                name: "file_ids",
                table: "email_messages",
                type: "uuid[]",
                nullable: false,
                defaultValue: new Guid[0]);

            migrationBuilder.AddColumn<string>(
                name: "reply_to",
                table: "email_messages",
                type: "character varying(254)",
                maxLength: 254,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "email_replies",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    transmittal_id = table.Column<Guid>(type: "uuid", nullable: false),
                    party_id = table.Column<Guid>(type: "uuid", nullable: false),
                    from_address = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    from_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    subject = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    text = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: false),
                    received_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    file_ids = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    state = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    recorded_transmittal_id = table.Column<Guid>(type: "uuid", nullable: true),
                    handled_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    handled_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    set_aside_reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_email_replies", x => x.id);
                    table.ForeignKey(
                        name: "fk_email_replies_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "reply_addresses",
                columns: table => new
                {
                    token = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    transmittal_id = table.Column<Guid>(type: "uuid", nullable: false),
                    party_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_reply_addresses", x => x.token);
                });

            migrationBuilder.CreateIndex(
                name: "ix_email_replies_project_id_state",
                table: "email_replies",
                columns: new[] { "project_id", "state" });

            migrationBuilder.CreateIndex(
                name: "ix_email_replies_tenant_id",
                table: "email_replies",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_email_replies_transmittal_id",
                table: "email_replies",
                column: "transmittal_id");

            migrationBuilder.CreateIndex(
                name: "ix_reply_addresses_transmittal_id",
                table: "reply_addresses",
                column: "transmittal_id");

            RowLevelSecurity.Enable(migrationBuilder, "email_replies");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "email_replies");

            migrationBuilder.DropTable(
                name: "reply_addresses");

            migrationBuilder.DropColumn(
                name: "contact_email",
                table: "parties");

            migrationBuilder.DropColumn(
                name: "file_ids",
                table: "email_messages");

            migrationBuilder.DropColumn(
                name: "reply_to",
                table: "email_messages");
        }
    }
}
