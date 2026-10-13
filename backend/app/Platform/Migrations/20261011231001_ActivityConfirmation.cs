using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class ActivityConfirmation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Instant>(
                name: "activity_checked_at",
                table: "transmittals",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "activity_checked_by_name",
                table: "transmittals",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "activity_confirm",
                table: "transmittals",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "activity_confirmer_id",
                table: "transmittals",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "activity_confirmer_name",
                table: "transmittals",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "activity_proposal",
                table: "transmittals",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "activity_checked_at",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "activity_checked_by_name",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "activity_confirm",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "activity_confirmer_id",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "activity_confirmer_name",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "activity_proposal",
                table: "transmittals");
        }
    }
}
