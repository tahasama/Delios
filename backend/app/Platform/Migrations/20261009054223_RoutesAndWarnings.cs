using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class RoutesAndWarnings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "verdict_set",
                table: "reviews",
                type: "text",
                nullable: false,
                defaultValue: "REVIEW_OUTCOMES");

            migrationBuilder.AddColumn<Guid[]>(
                name: "user_ids",
                table: "review_steps",
                type: "uuid[]",
                nullable: false,
                defaultValue: new Guid[0]);

            migrationBuilder.AddColumn<Instant>(
                name: "warned_at",
                table: "review_steps",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "verdict_set",
                table: "review_routes",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "verdict_set",
                table: "reviews");

            migrationBuilder.DropColumn(
                name: "user_ids",
                table: "review_steps");

            migrationBuilder.DropColumn(
                name: "warned_at",
                table: "review_steps");

            migrationBuilder.DropColumn(
                name: "verdict_set",
                table: "review_routes");
        }
    }
}
