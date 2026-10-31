using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// Planned days kept as they move (owner): the database writes each change of a document's planned day the moment it
    /// happens, so Progress by week judges a past week against the plan as it stood then. Nothing to fill from before:
    /// what a day was before this is not known, and reads as it stands.
    /// </summary>
    public partial class PlannedDateChanges : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "planned_date_changes",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    was = table.Column<LocalDate>(type: "date", nullable: true),
                    became = table.Column<LocalDate>(type: "date", nullable: true),
                    at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_planned_date_changes", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_planned_date_changes_project_id_document_id_at",
                table: "planned_date_changes",
                columns: new[] { "project_id", "document_id", "at" });

            Delios.Host.Tenancy.RowLevelSecurity.Enable(migrationBuilder, "planned_date_changes");

            migrationBuilder.Sql("""
                -- A document's planned day moved: written down at that moment, with what it was and what it became.
                CREATE FUNCTION record_planned_date() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    INSERT INTO planned_date_changes (tenant_id, project_id, document_id, was, became, at)
                        VALUES (NEW.tenant_id, NEW.project_id, NEW.id, OLD.planned_date, NEW.planned_date, now());
                    RETURN NULL;
                END
                $$;
                CREATE TRIGGER record_planned_date AFTER UPDATE OF planned_date ON documents
                    FOR EACH ROW WHEN (OLD.planned_date IS DISTINCT FROM NEW.planned_date)
                    EXECUTE FUNCTION record_planned_date();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS record_planned_date ON documents;
                DROP FUNCTION IF EXISTS record_planned_date();
                """);
            migrationBuilder.DropTable(
                name: "planned_date_changes");
        }
    }
}
