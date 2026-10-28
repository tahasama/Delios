using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class SupportRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "support_requests",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    project_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    subject = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    message = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    by_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    answer = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    answered_by = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    answered_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_support_requests", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_support_requests_at",
                table: "support_requests",
                column: "at");

            migrationBuilder.CreateIndex(
                name: "ix_support_requests_tenant_id_by_user_id_at",
                table: "support_requests",
                columns: new[] { "tenant_id", "by_user_id", "at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "support_requests");
        }
    }
}
