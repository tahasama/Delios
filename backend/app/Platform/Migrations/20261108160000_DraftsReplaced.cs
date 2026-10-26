using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class DraftsReplaced : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Files are kept, but a draft has no value (owner: "those files have no value unless they are past that
            // stage"): a file of a revision's current submission while the revision is in preparation, came on no
            // transmittal, and nothing has looked at it (no review of the revision, no transmittal line carrying it), may
            // go when a newer one replaces it; so may an upload never used. Every other file stays, as before.
            migrationBuilder.Sql("""
                CREATE FUNCTION stored_files_kept_unless_draft() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF OLD.revision_id IS NULL AND OLD.status = 'AWAITING_UPLOAD' THEN RETURN OLD; END IF;
                    IF OLD.kind IN ('NATIVE', 'RENDITION') AND OLD.transmittal_item_id IS NULL
                        AND EXISTS (SELECT 1 FROM revisions r WHERE r.id = OLD.revision_id AND r.state = 'IN_PREPARATION' AND r.submission = OLD.submission)
                        AND NOT EXISTS (SELECT 1 FROM reviews v WHERE v.revision_id = OLD.revision_id)
                        AND NOT EXISTS (SELECT 1 FROM transmittal_items i WHERE i.revision_id = OLD.revision_id
                            AND (i.submission IS NULL OR i.submission = OLD.submission))
                    THEN RETURN OLD; END IF;
                    RAISE EXCEPTION '% records are kept: they are never deleted', TG_TABLE_NAME
                        USING ERRCODE = 'restrict_violation';
                END
                $$;
                DROP TRIGGER stored_files_kept ON stored_files;
                CREATE TRIGGER stored_files_kept BEFORE DELETE ON stored_files FOR EACH ROW EXECUTE FUNCTION stored_files_kept_unless_draft();

                -- A draft gone: its document's facts read its files again.
                CREATE FUNCTION facts_after_file_gone() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF OLD.document_id IS NOT NULL THEN PERFORM refresh_document_facts(OLD.document_id); END IF;
                    RETURN NULL;
                END
                $$;
                CREATE TRIGGER facts_after_file_gone AFTER DELETE ON stored_files
                    FOR EACH ROW EXECUTE FUNCTION facts_after_file_gone();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS facts_after_file_gone ON stored_files;
                DROP FUNCTION IF EXISTS facts_after_file_gone();
                DROP TRIGGER stored_files_kept ON stored_files;
                CREATE TRIGGER stored_files_kept BEFORE DELETE ON stored_files FOR EACH ROW EXECUTE FUNCTION records_are_kept();
                DROP FUNCTION IF EXISTS stored_files_kept_unless_draft();
                """);
        }
    }
}
