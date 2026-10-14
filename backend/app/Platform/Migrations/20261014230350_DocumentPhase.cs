using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class DocumentPhase : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "phase",
                table: "revisions",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "phase",
                table: "documents",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "phase",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "phase",
                table: "documents");
        }
    }
}
