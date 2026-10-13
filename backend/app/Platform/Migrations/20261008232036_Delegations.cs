using System;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class Delegations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "answered_by_id",
                table: "review_participants",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "answered_by_name",
                table: "review_participants",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "review_delegations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    review_id = table.Column<Guid>(type: "uuid", nullable: false),
                    step_index = table.Column<int>(type: "integer", nullable: false),
                    from_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    from_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    to_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    to_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    verb = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    end_date = table.Column<LocalDate>(type: "date", nullable: false),
                    reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    refused_reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    flag = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    asked_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    granted_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    granted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_review_delegations", x => x.id);
                    table.ForeignKey(
                        name: "fk_review_delegations_reviews_review_id",
                        column: x => x.review_id,
                        principalTable: "reviews",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_review_delegations_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_review_delegations_users_from_user_id",
                        column: x => x.from_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_review_delegations_users_to_user_id",
                        column: x => x.to_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_review_delegations_from_user_id",
                table: "review_delegations",
                column: "from_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_review_delegations_review_id_step_index_status",
                table: "review_delegations",
                columns: new[] { "review_id", "step_index", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_review_delegations_tenant_id",
                table: "review_delegations",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_review_delegations_to_user_id_status",
                table: "review_delegations",
                columns: new[] { "to_user_id", "status" });

            RowLevelSecurity.Enable(migrationBuilder, "review_delegations");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "review_delegations");

            migrationBuilder.DropColumn(
                name: "answered_by_id",
                table: "review_participants");

            migrationBuilder.DropColumn(
                name: "answered_by_name",
                table: "review_participants");
        }
    }
}
