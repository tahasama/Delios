using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// An action keeps when its last document came, once every one it needs is there (written by Readiness with the rest
    /// of where it stands), so the Schedule reads where every action stands without reading their needs. Filled once.
    /// </summary>
    public partial class ActionLastMet : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Instant>(
                name: "last_met_at",
                table: "activities",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.Sql("""
                DO $$
                DECLARE t record;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        UPDATE activities a SET last_met_at = (SELECT max(r.met_at) FROM requirements r WHERE r.activity_id = a.id)
                            WHERE a.need_count > 0 AND a.met_count = a.need_count;
                    END LOOP;
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "last_met_at",
                table: "activities");
        }
    }
}
