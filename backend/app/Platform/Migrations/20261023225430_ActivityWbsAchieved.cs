using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class ActivityWbsAchieved : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "finish_achieved",
                table: "activities",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "start_achieved",
                table: "activities",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string[]>(
                name: "wbs",
                table: "activities",
                type: "text[]",
                nullable: false,
                defaultValue: new string[0]);

            migrationBuilder.AddColumn<int>(
                name: "wbs_order",
                table: "activities",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "finish_achieved",
                table: "activities");

            migrationBuilder.DropColumn(
                name: "start_achieved",
                table: "activities");

            migrationBuilder.DropColumn(
                name: "wbs",
                table: "activities");

            migrationBuilder.DropColumn(
                name: "wbs_order",
                table: "activities");
        }
    }
}
