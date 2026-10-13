using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class ActivityMoved : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Instant>(
                name: "moved_at",
                table: "activities",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "moved_in",
                table: "activities",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<LocalDate>(
                name: "was_finish",
                table: "activities",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<LocalDate>(
                name: "was_start",
                table: "activities",
                type: "date",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "moved_at",
                table: "activities");

            migrationBuilder.DropColumn(
                name: "moved_in",
                table: "activities");

            migrationBuilder.DropColumn(
                name: "was_finish",
                table: "activities");

            migrationBuilder.DropColumn(
                name: "was_start",
                table: "activities");
        }
    }
}
