using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class HomeIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "ix_transmittal_items_waiting",
                table: "transmittal_items",
                column: "kind",
                filter: "registered_at IS NULL AND returned_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_revisions_authored_by_id_state",
                table: "revisions",
                columns: new[] { "authored_by_id", "state" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_transmittal_items_waiting",
                table: "transmittal_items");

            migrationBuilder.DropIndex(
                name: "ix_revisions_authored_by_id_state",
                table: "revisions");
        }
    }
}
