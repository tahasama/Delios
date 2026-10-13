using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class KeepWhatPeopleWrote : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "unvoid_reason",
                table: "revisions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "unvoided_at",
                table: "revisions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "unvoided_by_name",
                table: "revisions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "send_backs",
                table: "reviews",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "reclassify_note",
                table: "review_comments",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "accept_note",
                table: "packages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "end_reason",
                table: "documents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "ended_at",
                table: "documents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ended_by_name",
                table: "documents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "legal_hold_lift_reason",
                table: "documents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "legal_hold_lifted_at",
                table: "documents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "legal_hold_lifted_by_name",
                table: "documents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "reinstate_reason",
                table: "documents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "reinstated_at",
                table: "documents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "reinstated_by_name",
                table: "documents",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "unvoid_reason",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "unvoided_at",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "unvoided_by_name",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "send_backs",
                table: "reviews");

            migrationBuilder.DropColumn(
                name: "reclassify_note",
                table: "review_comments");

            migrationBuilder.DropColumn(
                name: "accept_note",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "end_reason",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "ended_at",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "ended_by_name",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "legal_hold_lift_reason",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "legal_hold_lifted_at",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "legal_hold_lifted_by_name",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "reinstate_reason",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "reinstated_at",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "reinstated_by_name",
                table: "documents");
        }
    }
}
