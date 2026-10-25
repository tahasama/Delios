using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// Files are never read (owner: "never ever read the files… forbidden forever"): every project's switch goes to OFF,
    /// and, as OFF always meant, the text already read is deleted; the documents it came from are marked changed, so the
    /// search index sends them again with their details only.
    /// </summary>
    public partial class FilesNeverRead : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$
                DECLARE t record;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        UPDATE documents SET updated_at = now() WHERE id IN (SELECT DISTINCT document_id FROM file_texts);
                        DELETE FROM file_texts;
                        UPDATE projects SET content_extraction = 'OFF' WHERE content_extraction <> 'OFF';
                    END LOOP;
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // What was deleted is not brought back.
        }
    }
}
