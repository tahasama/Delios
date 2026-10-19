using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class IntakeExceptionOnly : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Taking documents as they come is a project's exception, chosen by hand (owner). A project put on it from what
            // a package said before, with nothing taken so yet, goes back to placeholders.
            migrationBuilder.Sql("""
                DO $$
                DECLARE t record;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        DELETE FROM settings s
                        WHERE s.tenant_id = t.id AND s.key IN ('SUPPLIER_INTAKE', 'AS_RECEIVED_FILING') AND s.project_id IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.project_id = s.project_id AND d.as_received);
                    END LOOP;
                    PERFORM set_config('app.tenant_id', '', true);
                END $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
