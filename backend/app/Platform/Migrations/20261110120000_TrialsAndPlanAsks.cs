using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class TrialsAndPlanAsks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "plan_asked",
                table: "subscriptions",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "plan_asked_at",
                table: "subscriptions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "plan_asked_by",
                table: "subscriptions",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "plan_asked_note",
                table: "subscriptions",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "plan_asked_users",
                table: "subscriptions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "remind_at",
                table: "subscriptions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "trial_told_at",
                table: "subscriptions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_subscriptions_remind_at",
                table: "subscriptions",
                column: "remind_at");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_subscriptions_remind_at",
                table: "subscriptions");

            migrationBuilder.DropColumn(
                name: "plan_asked",
                table: "subscriptions");

            migrationBuilder.DropColumn(
                name: "plan_asked_at",
                table: "subscriptions");

            migrationBuilder.DropColumn(
                name: "plan_asked_by",
                table: "subscriptions");

            migrationBuilder.DropColumn(
                name: "plan_asked_note",
                table: "subscriptions");

            migrationBuilder.DropColumn(
                name: "plan_asked_users",
                table: "subscriptions");

            migrationBuilder.DropColumn(
                name: "remind_at",
                table: "subscriptions");

            migrationBuilder.DropColumn(
                name: "trial_told_at",
                table: "subscriptions");
        }
    }
}
