using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class AuditLookups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "ix_audit_events_action_id",
                table: "audit_events",
                columns: new[] { "action", "id" });

            migrationBuilder.CreateIndex(
                name: "ix_audit_events_actor_id_entity_id_at",
                table: "audit_events",
                columns: new[] { "actor_id", "entity_id", "at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_audit_events_action_id",
                table: "audit_events");

            migrationBuilder.DropIndex(
                name: "ix_audit_events_actor_id_entity_id_at",
                table: "audit_events");
        }
    }
}
