using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class IntakeOnProject : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Taking documents as they come is a project's exception, chosen by hand (owner): no project is put on it
            // from what a package said before.
            migrationBuilder.DropColumn(
                name: "as_received_at",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "as_received_by_name",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "as_received_deliverable_type",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "as_received_discipline",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "as_received_doc_type",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "takes_as_received",
                table: "packages");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Instant>(
                name: "as_received_at",
                table: "packages",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "as_received_by_name",
                table: "packages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "as_received_deliverable_type",
                table: "packages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "as_received_discipline",
                table: "packages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "as_received_doc_type",
                table: "packages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "takes_as_received",
                table: "packages",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }
    }
}
