using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// Recorded as it happens (owner: "record the thing using the trigger that happens anyway"): the database writes, at
    /// the moment a transmittal or its line is added, the revision a transmittal first carried (revision_facts: released
    /// with none is "not sent yet") and the transmittal first answered or followed by someone else (transmittal_facts).
    /// Never on the rows they are about (they carry a version stamp). Filled once from what exists.
    /// </summary>
    public partial class RecordedAsItHappens : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "revision_facts",
                columns: table => new
                {
                    revision_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    first_carried_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_revision_facts", x => x.revision_id);
                });

            migrationBuilder.CreateTable(
                name: "transmittal_facts",
                columns: table => new
                {
                    transmittal_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    answered_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_transmittal_facts", x => x.transmittal_id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_revision_facts_tenant_id",
                table: "revision_facts",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_transmittal_facts_tenant_id",
                table: "transmittal_facts",
                column: "tenant_id");

            Delios.Host.Tenancy.RowLevelSecurity.Enable(migrationBuilder, "revision_facts", "transmittal_facts");

            migrationBuilder.Sql("""
                -- A line added to a transmittal other than a review's: its revision is carried, the first time recorded.
                CREATE FUNCTION record_carried() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF NEW.revision_id IS NOT NULL THEN
                        INSERT INTO revision_facts (revision_id, tenant_id, project_id, first_carried_at)
                            SELECT NEW.revision_id, x.tenant_id, x.project_id, x.issued_at
                            FROM transmittals x WHERE x.id = NEW.transmittal_id AND x.review_step_id IS NULL
                        ON CONFLICT (revision_id) DO NOTHING;
                    END IF;
                    RETURN NULL;
                END
                $$;
                CREATE TRIGGER record_carried AFTER INSERT ON transmittal_items
                    FOR EACH ROW EXECUTE FUNCTION record_carried();

                -- A transmittal answering one, or following one sent by someone else: that one is answered, the first time recorded.
                CREATE FUNCTION record_answered() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    INSERT INTO transmittal_facts (transmittal_id, tenant_id, project_id, answered_at)
                        SELECT p.id, p.tenant_id, p.project_id, NEW.issued_at FROM transmittals p
                        WHERE p.id = NEW.in_reply_to_id
                            OR (p.id = NEW.follows_id AND p.issued_by_id IS DISTINCT FROM NEW.issued_by_id)
                    ON CONFLICT (transmittal_id) DO UPDATE SET answered_at = least(transmittal_facts.answered_at, EXCLUDED.answered_at);
                    RETURN NULL;
                END
                $$;
                CREATE TRIGGER record_answered AFTER INSERT ON transmittals
                    FOR EACH ROW WHEN (NEW.in_reply_to_id IS NOT NULL OR NEW.follows_id IS NOT NULL)
                    EXECUTE FUNCTION record_answered();
                """);
            migrationBuilder.Sql(Delios.Host.Platform.Recorded.Rebuild);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS record_carried ON transmittal_items;
                DROP TRIGGER IF EXISTS record_answered ON transmittals;
                DROP FUNCTION IF EXISTS record_carried();
                DROP FUNCTION IF EXISTS record_answered();
                """);
            migrationBuilder.DropTable(
                name: "revision_facts");

            migrationBuilder.DropTable(
                name: "transmittal_facts");
        }
    }
}
