using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class PeopleConfirmation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Instant>(
                name: "confirmed_at",
                table: "memberships",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "confirmed_by_name",
                table: "memberships",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "confirmer_id",
                table: "memberships",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "confirmer_name",
                table: "memberships",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "pending_since",
                table: "memberships",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "proposed_by_id",
                table: "memberships",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "proposed_by_name",
                table: "memberships",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "refused_at",
                table: "memberships",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "refused_by_name",
                table: "memberships",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "refused_reason",
                table: "memberships",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "confirmed_at",
                table: "memberships");

            migrationBuilder.DropColumn(
                name: "confirmed_by_name",
                table: "memberships");

            migrationBuilder.DropColumn(
                name: "confirmer_id",
                table: "memberships");

            migrationBuilder.DropColumn(
                name: "confirmer_name",
                table: "memberships");

            migrationBuilder.DropColumn(
                name: "pending_since",
                table: "memberships");

            migrationBuilder.DropColumn(
                name: "proposed_by_id",
                table: "memberships");

            migrationBuilder.DropColumn(
                name: "proposed_by_name",
                table: "memberships");

            migrationBuilder.DropColumn(
                name: "refused_at",
                table: "memberships");

            migrationBuilder.DropColumn(
                name: "refused_by_name",
                table: "memberships");

            migrationBuilder.DropColumn(
                name: "refused_reason",
                table: "memberships");
        }
    }
}
