using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// What the register filters and sorts on beyond a document's own columns (released and at what, its newest revision's
    /// verdict and whether it waits to be released, its last file, when it first went out), and how many documents carry
    /// each discipline and document type: written by the database as the revision, review, file, transmittal line or
    /// document changes (owner: recorded when it happens, never swept for). Filled once from what exists.
    /// </summary>
    public partial class RegisterRecorded : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "document_facts",
                columns: table => new
                {
                    document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    released = table.Column<bool>(type: "boolean", nullable: false),
                    released_status = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    released_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    verdict = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    decided = table.Column<bool>(type: "boolean", nullable: false),
                    file_added_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    first_issued_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_document_facts", x => x.document_id);
                });

            migrationBuilder.CreateTable(
                name: "values_used",
                columns: table => new
                {
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    field = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    documents = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_values_used", x => new { x.project_id, x.field, x.code });
                });

            migrationBuilder.CreateIndex(
                name: "ix_document_facts_tenant_id",
                table: "document_facts",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_values_used_tenant_id",
                table: "values_used",
                column: "tenant_id");

            Delios.Host.Tenancy.RowLevelSecurity.Enable(migrationBuilder, "document_facts", "values_used");

            migrationBuilder.Sql("""
                -- A document's facts, worked out again for that one document only, whenever one of them may have moved.
                CREATE FUNCTION refresh_document_facts(p_doc uuid) RETURNS void LANGUAGE plpgsql AS $$
                DECLARE
                    d record;
                    v_status text; v_released_at timestamptz; v_released boolean;
                BEGIN
                    SELECT id, tenant_id, project_id, latest_revision_id INTO d FROM documents WHERE id = p_doc;
                    IF NOT FOUND THEN RETURN; END IF;
                    SELECT status_code, released_at INTO v_status, v_released_at FROM revisions
                        WHERE document_id = p_doc AND state = 'RELEASED' ORDER BY released_at DESC NULLS LAST LIMIT 1;
                    v_released := FOUND;
                    INSERT INTO document_facts (document_id, tenant_id, project_id, released, released_status, released_at,
                        verdict, decided, file_added_at, first_issued_at)
                    VALUES (d.id, d.tenant_id, d.project_id, v_released, v_status, v_released_at,
                        (SELECT verdict FROM reviews WHERE revision_id = d.latest_revision_id AND verdict IS NOT NULL
                            ORDER BY decided_at DESC NULLS LAST LIMIT 1),
                        EXISTS (SELECT 1 FROM reviews WHERE revision_id = d.latest_revision_id AND state = 'DECIDED'),
                        (SELECT max(created_at) FROM stored_files WHERE document_id = p_doc),
                        (SELECT min(x.issued_at) FROM transmittal_items i JOIN transmittals x ON x.id = i.transmittal_id
                            WHERE i.document_id = p_doc AND x.review_step_id IS NULL AND x.direction = 'OUTGOING' AND i.kind = 'REVISION'))
                    ON CONFLICT (document_id) DO UPDATE SET released = EXCLUDED.released, released_status = EXCLUDED.released_status,
                        released_at = EXCLUDED.released_at, verdict = EXCLUDED.verdict, decided = EXCLUDED.decided,
                        file_added_at = EXCLUDED.file_added_at, first_issued_at = EXCLUDED.first_issued_at;
                END
                $$;

                CREATE FUNCTION facts_of_document() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    PERFORM refresh_document_facts(NEW.id);
                    RETURN NULL;
                END
                $$;
                CREATE TRIGGER facts_of_document AFTER INSERT OR UPDATE OF latest_revision_id ON documents
                    FOR EACH ROW EXECUTE FUNCTION facts_of_document();

                CREATE FUNCTION facts_of_its_document() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF NEW.document_id IS NOT NULL THEN PERFORM refresh_document_facts(NEW.document_id); END IF;
                    RETURN NULL;
                END
                $$;
                CREATE TRIGGER facts_of_its_document AFTER INSERT OR UPDATE OF state, status_code, released_at ON revisions
                    FOR EACH ROW EXECUTE FUNCTION facts_of_its_document();
                CREATE TRIGGER facts_of_its_document AFTER INSERT OR UPDATE OF verdict, state, decided_at ON reviews
                    FOR EACH ROW EXECUTE FUNCTION facts_of_its_document();
                CREATE TRIGGER facts_of_its_document AFTER INSERT ON stored_files
                    FOR EACH ROW EXECUTE FUNCTION facts_of_its_document();
                CREATE TRIGGER facts_of_its_document AFTER INSERT ON transmittal_items
                    FOR EACH ROW EXECUTE FUNCTION facts_of_its_document();

                -- How many documents carry each discipline and document type, counted up and down as they change.
                CREATE FUNCTION count_values_used() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF TG_OP IN ('UPDATE', 'DELETE') THEN
                        UPDATE values_used SET documents = documents - 1
                            WHERE project_id = OLD.project_id AND ((field = 'DISCIPLINE' AND code = OLD.discipline) OR (field = 'DOC_TYPE' AND code = OLD.doc_type));
                    END IF;
                    IF TG_OP IN ('INSERT', 'UPDATE') THEN
                        INSERT INTO values_used (project_id, field, code, tenant_id, documents)
                            VALUES (NEW.project_id, 'DISCIPLINE', NEW.discipline, NEW.tenant_id, 1), (NEW.project_id, 'DOC_TYPE', NEW.doc_type, NEW.tenant_id, 1)
                        ON CONFLICT (project_id, field, code) DO UPDATE SET documents = values_used.documents + 1;
                    END IF;
                    RETURN NULL;
                END
                $$;
                CREATE TRIGGER count_values_used AFTER INSERT OR DELETE OR UPDATE OF discipline, doc_type, project_id ON documents
                    FOR EACH ROW EXECUTE FUNCTION count_values_used();
                """);
            migrationBuilder.Sql(Delios.Host.Platform.Recorded.Rebuild);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS facts_of_document ON documents;
                DROP TRIGGER IF EXISTS count_values_used ON documents;
                DROP TRIGGER IF EXISTS facts_of_its_document ON revisions;
                DROP TRIGGER IF EXISTS facts_of_its_document ON reviews;
                DROP TRIGGER IF EXISTS facts_of_its_document ON stored_files;
                DROP TRIGGER IF EXISTS facts_of_its_document ON transmittal_items;
                DROP FUNCTION IF EXISTS facts_of_document();
                DROP FUNCTION IF EXISTS facts_of_its_document();
                DROP FUNCTION IF EXISTS count_values_used();
                DROP FUNCTION IF EXISTS refresh_document_facts(uuid);
                """);
            migrationBuilder.DropTable(
                name: "document_facts");

            migrationBuilder.DropTable(
                name: "values_used");
        }
    }
}
