using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class ActivityRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "activity_answer",
                table: "transmittals",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "activity_answered_at",
                table: "transmittals",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "activity_answered_by_name",
                table: "transmittals",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "activity_id",
                table: "transmittals",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "activity_answer",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "activity_answered_at",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "activity_answered_by_name",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "activity_id",
                table: "transmittals");
        }
    }
}
