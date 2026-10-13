using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class ControlOutcomes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "submission",
                table: "stored_files",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<string>(
                name: "control_outcome",
                table: "revisions",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "submission",
                table: "revisions",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<string>(
                name: "submissions",
                table: "revisions",
                type: "jsonb",
                nullable: true,
                defaultValue: "[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "submission",
                table: "stored_files");

            migrationBuilder.DropColumn(
                name: "control_outcome",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "submission",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "submissions",
                table: "revisions");
        }
    }
}
