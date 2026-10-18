using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// Verdict lists become sets of the review outcomes (owner: one list, its sets, edited in Types &amp; sets like any list).
    /// Each verdict list made by the organization becomes a set of REVIEW_OUTCOMES named by its title, in every scope holding
    /// it (the organization's lists and each project's own copy), and its verdicts go into it. A code already in the review
    /// outcomes stays where it was (a code is never repeated in a list, and never changes once used), and so do the reviews
    /// decided with it. Routes name the set they decide from (review_routes.verdicts; none: the set serving the document's
    /// deliverable type); each review keeps the set it was offered (reviews.verdicts).
    /// </summary>
    public partial class VerdictSets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "verdicts", table: "review_routes", type: "character varying(120)", maxLength: 120, nullable: true);
            migrationBuilder.AddColumn<string>(name: "verdicts", table: "reviews", type: "character varying(120)", maxLength: 120, nullable: true);

            migrationBuilder.Sql("""
                DO $$
                DECLARE t record; x record; sc record; title text; nm text; sid uuid;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        FOR x IN
                            SELECT substr(key, 5) AS k FROM settings
                            WHERE project_id IS NULL AND key LIKE 'SET:%' AND value LIKE '%"VERDICTS"%' AND key <> 'SET:REVIEW_OUTCOMES'
                            UNION
                            SELECT verdict_set FROM review_routes WHERE verdict_set IS NOT NULL AND verdict_set <> 'REVIEW_OUTCOMES'
                        LOOP
                            title := coalesce((SELECT value::jsonb->>'title' FROM settings WHERE project_id IS NULL AND key = 'SET:' || x.k LIMIT 1), x.k);
                            nm := left(title, 100);
                            IF EXISTS (SELECT 1 FROM value_sets WHERE list_key = 'REVIEW_OUTCOMES' AND name = nm) THEN
                                nm := left(title, 90) || ' (' || left(x.k, 20) || ')';
                            END IF;
                            FOR sc IN SELECT DISTINCT project_id FROM value_entries WHERE set_key = x.k LOOP
                                sid := gen_random_uuid();
                                INSERT INTO value_sets (id, tenant_id, project_id, list_key, name, deliverable_types, is_default, active, sort)
                                VALUES (sid, t.id, sc.project_id, 'REVIEW_OUTCOMES', nm, '{}', false, true, 100);
                                UPDATE value_entries e SET set_key = 'REVIEW_OUTCOMES', set_id = sid
                                WHERE e.set_key = x.k AND e.project_id IS NOT DISTINCT FROM sc.project_id
                                  AND NOT EXISTS (SELECT 1 FROM value_entries o WHERE o.set_key = 'REVIEW_OUTCOMES'
                                                  AND o.project_id IS NOT DISTINCT FROM sc.project_id AND o.code = e.code);
                                DELETE FROM value_sets s WHERE s.list_key = x.k AND s.project_id IS NOT DISTINCT FROM sc.project_id
                                  AND NOT EXISTS (SELECT 1 FROM value_entries e WHERE e.set_id = s.id);
                            END LOOP;
                            UPDATE review_routes SET verdicts = nm, verdict_set = NULL WHERE verdict_set = x.k;
                            UPDATE reviews r SET verdict_set = 'REVIEW_OUTCOMES', verdicts = nm
                            WHERE r.verdict_set = x.k
                              AND (r.verdict IS NULL OR NOT EXISTS (SELECT 1 FROM value_entries e WHERE e.set_key = x.k AND e.code = r.verdict));
                            IF NOT EXISTS (SELECT 1 FROM value_entries WHERE set_key = x.k) THEN
                                DELETE FROM settings WHERE key = 'SET:' || x.k;
                            END IF;
                        END LOOP;
                        UPDATE review_routes SET verdict_set = NULL WHERE verdict_set = 'REVIEW_OUTCOMES';
                    END LOOP;
                    PERFORM set_config('app.tenant_id', '', true);
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "verdicts", table: "reviews");
            migrationBuilder.DropColumn(name: "verdicts", table: "review_routes");
        }
    }
}
