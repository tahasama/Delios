using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class SupplierTakeBack : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Instant>(
                name: "resent_at",
                table: "revisions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "resent_by_name",
                table: "revisions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "resent_note",
                table: "revisions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "relocked_at",
                table: "documents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "relocked_by_name",
                table: "documents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "unlock_reason",
                table: "documents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "unlocked_at",
                table: "documents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "unlocked_by_name",
                table: "documents",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "resent_at",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "resent_by_name",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "resent_note",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "relocked_at",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "relocked_by_name",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "unlock_reason",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "unlocked_at",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "unlocked_by_name",
                table: "documents");
        }
    }
}
