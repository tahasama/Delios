using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// Opening and downloading are kept outside the locked chain (owner: every reader waited behind every other act of
    /// the organization): written by <c>audit_note</c>, with no lock and no link to the row before, each row sealed by its
    /// own hash. Acts that change something stay in the chain, one writer at a time, as before; the chain now links only
    /// its own rows. Both stay in the same table, append-only, read by the same readers.
    /// </summary>
    public partial class ReadingOutsideChain : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE audit_events ADD COLUMN chained boolean NOT NULL DEFAULT true;
                CREATE INDEX ix_audit_events_tenant_id_id_chained ON audit_events (tenant_id, id) WHERE chained;

                CREATE OR REPLACE FUNCTION audit_append(
                    p_tenant uuid, p_project uuid, p_actor uuid, p_actor_name text, p_action text,
                    p_entity_type text, p_entity_id uuid, p_entity_label text, p_detail text)
                RETURNS void LANGUAGE plpgsql AS $$
                DECLARE
                    v_at timestamptz := clock_timestamp();
                    v_previous bytea;
                BEGIN
                    -- One writer per tenant at a time, until commit, so the chain never forks.
                    PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || p_tenant::text, 0));
                    SELECT hash INTO v_previous FROM audit_events
                        WHERE tenant_id = p_tenant AND chained ORDER BY id DESC LIMIT 1;
                    v_previous := coalesce(v_previous, ''::bytea);
                    INSERT INTO audit_events (tenant_id, project_id, at, actor_id, actor_name, action,
                        entity_type, entity_id, entity_label, detail, previous_hash, hash)
                    VALUES (p_tenant, p_project, v_at, p_actor, p_actor_name, p_action,
                        p_entity_type, p_entity_id, p_entity_label, p_detail, v_previous,
                        sha256(v_previous || audit_canonical(p_tenant, p_project, v_at, p_actor, p_actor_name,
                            p_action, p_entity_type, p_entity_id, p_entity_label, p_detail)));
                END
                $$;

                -- Reading (opened, downloaded): no lock, no link; the row is sealed by its own hash.
                CREATE FUNCTION audit_note(
                    p_tenant uuid, p_project uuid, p_actor uuid, p_actor_name text, p_action text,
                    p_entity_type text, p_entity_id uuid, p_entity_label text, p_detail text)
                RETURNS void LANGUAGE plpgsql AS $$
                DECLARE
                    v_at timestamptz := clock_timestamp();
                BEGIN
                    INSERT INTO audit_events (tenant_id, project_id, at, actor_id, actor_name, action,
                        entity_type, entity_id, entity_label, detail, previous_hash, hash, chained)
                    VALUES (p_tenant, p_project, v_at, p_actor, p_actor_name, p_action,
                        p_entity_type, p_entity_id, p_entity_label, p_detail, ''::bytea,
                        sha256(audit_canonical(p_tenant, p_project, v_at, p_actor, p_actor_name,
                            p_action, p_entity_type, p_entity_id, p_entity_label, p_detail)), false);
                END
                $$;

                CREATE OR REPLACE FUNCTION audit_verify(p_tenant uuid) RETURNS bigint LANGUAGE plpgsql STABLE AS $$
                DECLARE
                    r audit_events%ROWTYPE;
                    v_previous bytea := ''::bytea;
                BEGIN
                    FOR r IN SELECT * FROM audit_events WHERE tenant_id = p_tenant ORDER BY id LOOP
                        IF r.chained THEN
                            IF r.previous_hash <> v_previous
                                OR r.hash <> sha256(v_previous || audit_canonical(r.tenant_id, r.project_id, r.at,
                                    r.actor_id, r.actor_name, r.action, r.entity_type, r.entity_id, r.entity_label, r.detail))
                            THEN
                                RETURN r.id;
                            END IF;
                            v_previous := r.hash;
                        ELSIF r.hash <> sha256(audit_canonical(r.tenant_id, r.project_id, r.at,
                                r.actor_id, r.actor_name, r.action, r.entity_type, r.entity_id, r.entity_label, r.detail))
                        THEN
                            RETURN r.id;
                        END IF;
                    END LOOP;
                    RETURN NULL;
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The rows written outside the chain stay: the column and the functions that read them remain.
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS audit_note(uuid, uuid, uuid, text, text, text, uuid, text, text);");
        }
    }
}
