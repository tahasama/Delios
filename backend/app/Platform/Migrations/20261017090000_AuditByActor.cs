using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>A person's own record in the audit trail, newest first (Settings, People &amp; access).</summary>
    public partial class AuditByActor : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "ix_audit_events_actor_id_id",
                table: "audit_events",
                columns: new[] { "actor_id", "id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(name: "ix_audit_events_actor_id_id", table: "audit_events");
        }
    }
}
