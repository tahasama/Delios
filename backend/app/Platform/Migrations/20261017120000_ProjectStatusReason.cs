using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>Why a project was last archived, reopened or put on hold, by whom and when.</summary>
    public partial class ProjectStatusReason : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "status_reason", table: "projects", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "status_changed_by_name", table: "projects", type: "text", nullable: true);
            migrationBuilder.AddColumn<Instant>(name: "status_changed_at", table: "projects", type: "timestamp with time zone", nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "status_reason", table: "projects");
            migrationBuilder.DropColumn(name: "status_changed_by_name", table: "projects");
            migrationBuilder.DropColumn(name: "status_changed_at", table: "projects");
        }
    }
}
