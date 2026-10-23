using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class CalendarDaysOff : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "days_off",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    day = table.Column<LocalDate>(type: "date", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    country = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: true),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    created_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_days_off", x => x.id);
                    table.ForeignKey(
                        name: "fk_days_off_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_days_off_project_id_day",
                table: "days_off",
                columns: new[] { "project_id", "day" });

            migrationBuilder.CreateIndex(
                name: "ix_days_off_tenant_id",
                table: "days_off",
                column: "tenant_id");

            Delios.Host.Tenancy.RowLevelSecurity.Enable(migrationBuilder, "days_off");

            // Holidays marked as a list of Types & sets (code starting with the day, prop "country") move onto the
            // calendar, organization by organization; the list itself goes (it was only ever a calendar).
            migrationBuilder.Sql("""
                DO $$
                DECLARE t record;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        INSERT INTO days_off (id, tenant_id, project_id, day, name, country, created_at, created_by_name)
                            SELECT gen_random_uuid(), v.tenant_id, v.project_id, substring(v.code from 1 for 10)::date, left(v.label, 120),
                                   CASE WHEN v.project_id IS NULL THEN NULLIF(upper(v.props->>'country'), '') END, now(), 'Moved from Types & sets'
                            FROM value_entries v
                            WHERE v.tenant_id = t.id AND v.set_key = 'HOLIDAYS' AND v.status = 'ACTIVE'
                              AND v.code ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}';
                        DELETE FROM value_entries WHERE tenant_id = t.id AND set_key = 'HOLIDAYS';
                        DELETE FROM value_sets WHERE tenant_id = t.id AND list_key = 'HOLIDAYS';
                        DELETE FROM settings WHERE tenant_id = t.id AND key = 'LIBERTY:LIST:HOLIDAYS';
                    END LOOP;
                    PERFORM set_config('app.tenant_id', '', true);
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "days_off");
        }
    }
}
