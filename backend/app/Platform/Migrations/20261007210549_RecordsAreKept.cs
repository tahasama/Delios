using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class RecordsAreKept : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Records are never deleted: not by the application, not by a bug, not by a
            // mistaken query. Only the server owner can, as the database superuser, by
            // switching triggers off for their own session (SET session_replication_role = replica),
            // which the application's role is not allowed to do.
            migrationBuilder.Sql("""
                CREATE FUNCTION records_are_kept() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION '% records are kept: they are never deleted', TG_TABLE_NAME
                        USING ERRCODE = 'restrict_violation';
                END
                $$;
                CREATE TRIGGER documents_kept BEFORE DELETE ON documents FOR EACH ROW EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER documents_kept_truncate BEFORE TRUNCATE ON documents FOR EACH STATEMENT EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER revisions_kept BEFORE DELETE ON revisions FOR EACH ROW EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER revisions_kept_truncate BEFORE TRUNCATE ON revisions FOR EACH STATEMENT EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER stored_files_kept BEFORE DELETE ON stored_files FOR EACH ROW EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER stored_files_kept_truncate BEFORE TRUNCATE ON stored_files FOR EACH STATEMENT EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER reviews_kept BEFORE DELETE ON reviews FOR EACH ROW EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER reviews_kept_truncate BEFORE TRUNCATE ON reviews FOR EACH STATEMENT EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER review_steps_kept BEFORE DELETE ON review_steps FOR EACH ROW EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER review_steps_kept_truncate BEFORE TRUNCATE ON review_steps FOR EACH STATEMENT EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER review_comments_kept BEFORE DELETE ON review_comments FOR EACH ROW EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER review_comments_kept_truncate BEFORE TRUNCATE ON review_comments FOR EACH STATEMENT EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER transmittals_kept BEFORE DELETE ON transmittals FOR EACH ROW EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER transmittals_kept_truncate BEFORE TRUNCATE ON transmittals FOR EACH STATEMENT EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER transmittal_items_kept BEFORE DELETE ON transmittal_items FOR EACH ROW EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER transmittal_items_kept_truncate BEFORE TRUNCATE ON transmittal_items FOR EACH STATEMENT EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER transmittal_recipients_kept BEFORE DELETE ON transmittal_recipients FOR EACH ROW EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER transmittal_recipients_kept_truncate BEFORE TRUNCATE ON transmittal_recipients FOR EACH STATEMENT EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER packages_kept BEFORE DELETE ON packages FOR EACH ROW EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER packages_kept_truncate BEFORE TRUNCATE ON packages FOR EACH STATEMENT EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER schedule_imports_kept BEFORE DELETE ON schedule_imports FOR EACH ROW EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER schedule_imports_kept_truncate BEFORE TRUNCATE ON schedule_imports FOR EACH STATEMENT EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER activity_decisions_kept BEFORE DELETE ON activity_decisions FOR EACH ROW EXECUTE FUNCTION records_are_kept();
                CREATE TRIGGER activity_decisions_kept_truncate BEFORE TRUNCATE ON activity_decisions FOR EACH STATEMENT EXECUTE FUNCTION records_are_kept();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS documents_kept ON documents;
                DROP TRIGGER IF EXISTS documents_kept_truncate ON documents;
                DROP TRIGGER IF EXISTS revisions_kept ON revisions;
                DROP TRIGGER IF EXISTS revisions_kept_truncate ON revisions;
                DROP TRIGGER IF EXISTS stored_files_kept ON stored_files;
                DROP TRIGGER IF EXISTS stored_files_kept_truncate ON stored_files;
                DROP TRIGGER IF EXISTS reviews_kept ON reviews;
                DROP TRIGGER IF EXISTS reviews_kept_truncate ON reviews;
                DROP TRIGGER IF EXISTS review_steps_kept ON review_steps;
                DROP TRIGGER IF EXISTS review_steps_kept_truncate ON review_steps;
                DROP TRIGGER IF EXISTS review_comments_kept ON review_comments;
                DROP TRIGGER IF EXISTS review_comments_kept_truncate ON review_comments;
                DROP TRIGGER IF EXISTS transmittals_kept ON transmittals;
                DROP TRIGGER IF EXISTS transmittals_kept_truncate ON transmittals;
                DROP TRIGGER IF EXISTS transmittal_items_kept ON transmittal_items;
                DROP TRIGGER IF EXISTS transmittal_items_kept_truncate ON transmittal_items;
                DROP TRIGGER IF EXISTS transmittal_recipients_kept ON transmittal_recipients;
                DROP TRIGGER IF EXISTS transmittal_recipients_kept_truncate ON transmittal_recipients;
                DROP TRIGGER IF EXISTS packages_kept ON packages;
                DROP TRIGGER IF EXISTS packages_kept_truncate ON packages;
                DROP TRIGGER IF EXISTS schedule_imports_kept ON schedule_imports;
                DROP TRIGGER IF EXISTS schedule_imports_kept_truncate ON schedule_imports;
                DROP TRIGGER IF EXISTS activity_decisions_kept ON activity_decisions;
                DROP TRIGGER IF EXISTS activity_decisions_kept_truncate ON activity_decisions;
                DROP FUNCTION IF EXISTS records_are_kept();
                """);
        }
    }
}
