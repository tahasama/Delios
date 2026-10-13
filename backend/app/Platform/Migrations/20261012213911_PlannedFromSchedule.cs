using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class PlannedFromSchedule : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // A document the schedule needs is planned for the earliest day an active action needs it.
            migrationBuilder.Sql("""
                DO $$
                DECLARE t record;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        UPDATE documents d SET planned_date = n.day
                        FROM (SELECT x.document_id, min(x.day) AS day FROM (
                                SELECT r.document_id,
                                       COALESCE(r.needed_by, r.fixed_date,
                                                (CASE WHEN r.anchor = 'FINISH' THEN a.finish ELSE a.start END) + r.offset_days) AS day
                                FROM requirements r JOIN activities a ON a.id = r.activity_id
                                WHERE a.state = 'ACTIVE' AND r.tenant_id = t.id) x
                              WHERE x.day IS NOT NULL
                              GROUP BY x.document_id) n
                        WHERE d.id = n.document_id AND d.tenant_id = t.id AND d.planned_date IS DISTINCT FROM n.day;
                    END LOOP;
                    PERFORM set_config('app.tenant_id', '', true);
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {

        }
    }
}
