using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class StampPlace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Instant>(
                name: "stamp_placed_at",
                table: "revisions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "stamp_placed_by_name",
                table: "revisions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "stamp_x",
                table: "revisions",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "stamp_y",
                table: "revisions",
                type: "double precision",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "stamp_placed_at",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "stamp_placed_by_name",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "stamp_x",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "stamp_y",
                table: "revisions");
        }
    }
}
