using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// Indexes the reads asked often (a document's History, a project's log, Home's revisions, the newest revision, what
    /// passed with another organization, a person's notifications on a project), and <c>people_seen</c>: when a person
    /// last signed in, first and last acted on each project and was put on it, written by the audit functions with the
    /// act itself (owner: never worked out again from the whole audit trail), filled once from the trail as it stands.
    /// </summary>
    public partial class PeopleSeenAndIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_transmittal_items_document_id",
                table: "transmittal_items");

            migrationBuilder.CreateTable(
                name: "people_seen",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    first_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    last_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    joined_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_people_seen", x => new { x.user_id, x.project_id });
                });

            migrationBuilder.CreateIndex(
                name: "ix_transmittal_items_document_id_kind",
                table: "transmittal_items",
                columns: new[] { "document_id", "kind" });

            migrationBuilder.CreateIndex(
                name: "ix_revisions_project_id_state",
                table: "revisions",
                columns: new[] { "project_id", "state" });

            migrationBuilder.CreateIndex(
                name: "ix_notifications_user_id_project_id_created_at",
                table: "notifications",
                columns: new[] { "user_id", "project_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_documents_latest_revision_id",
                table: "documents",
                column: "latest_revision_id");

            migrationBuilder.CreateIndex(
                name: "ix_audit_events_entity_id_id",
                table: "audit_events",
                columns: new[] { "entity_id", "id" });

            migrationBuilder.CreateIndex(
                name: "ix_audit_events_project_id_id",
                table: "audit_events",
                columns: new[] { "project_id", "id" });

            migrationBuilder.CreateIndex(
                name: "ix_people_seen_tenant_id",
                table: "people_seen",
                column: "tenant_id");

            Delios.Host.Tenancy.RowLevelSecurity.Enable(migrationBuilder, "people_seen");

            migrationBuilder.Sql("""
                -- Who was seen where, written with the act: acting or reading on a project (last, at most once a minute;
                -- first), signing in (no project: the empty id), being put on a project (the earliest).
                CREATE FUNCTION audit_seen(p_tenant uuid, p_project uuid, p_actor uuid, p_action text,
                    p_entity_type text, p_entity_id uuid, p_at timestamptz)
                RETURNS void LANGUAGE plpgsql AS $$
                BEGIN
                    IF p_actor IS NOT NULL AND p_project IS NOT NULL THEN
                        INSERT INTO people_seen (tenant_id, user_id, project_id, first_at, last_at)
                            VALUES (p_tenant, p_actor, p_project, p_at, p_at)
                        ON CONFLICT (user_id, project_id) DO UPDATE
                            SET last_at = EXCLUDED.last_at, first_at = coalesce(people_seen.first_at, EXCLUDED.first_at)
                            WHERE people_seen.last_at IS NULL OR people_seen.last_at < EXCLUDED.last_at - interval '1 minute';
                    END IF;
                    IF p_actor IS NOT NULL AND p_action IN ('SIGN_IN', 'SIGN_IN_MFA', 'SIGN_IN_SSO', 'LOGIN', 'SWITCHED_IN') THEN
                        INSERT INTO people_seen (tenant_id, user_id, project_id, last_at)
                            VALUES (p_tenant, p_actor, '00000000-0000-0000-0000-000000000000', p_at)
                        ON CONFLICT (user_id, project_id) DO UPDATE SET last_at = EXCLUDED.last_at;
                    END IF;
                    IF p_entity_type = 'User' AND p_entity_id IS NOT NULL AND p_project IS NOT NULL
                        AND p_action IN ('MEMBERSHIP_CHANGED', 'PERSON_JOINED_PROJECT') THEN
                        INSERT INTO people_seen (tenant_id, user_id, project_id, joined_at)
                            VALUES (p_tenant, p_entity_id, p_project, p_at)
                        ON CONFLICT (user_id, project_id) DO UPDATE SET joined_at = EXCLUDED.joined_at
                            WHERE people_seen.joined_at IS NULL;
                    END IF;
                END
                $$;

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
                    PERFORM audit_seen(p_tenant, p_project, p_actor, p_action, p_entity_type, p_entity_id, v_at);
                END
                $$;

                CREATE OR REPLACE FUNCTION audit_note(
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
                    PERFORM audit_seen(p_tenant, p_project, p_actor, p_action, p_entity_type, p_entity_id, v_at);
                END
                $$;

                -- Filled once from the trail as it stands, organization by organization.
                DO $$
                DECLARE t record;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        INSERT INTO people_seen (tenant_id, user_id, project_id, first_at, last_at)
                            SELECT t.id, actor_id, project_id, min(at), max(at) FROM audit_events
                            WHERE tenant_id = t.id AND actor_id IS NOT NULL AND project_id IS NOT NULL
                            GROUP BY actor_id, project_id;
                        INSERT INTO people_seen (tenant_id, user_id, project_id, last_at)
                            SELECT t.id, actor_id, '00000000-0000-0000-0000-000000000000', max(at) FROM audit_events
                            WHERE tenant_id = t.id AND actor_id IS NOT NULL
                                AND action IN ('SIGN_IN', 'SIGN_IN_MFA', 'SIGN_IN_SSO', 'LOGIN', 'SWITCHED_IN')
                            GROUP BY actor_id;
                        INSERT INTO people_seen (tenant_id, user_id, project_id, joined_at)
                            SELECT t.id, entity_id, project_id, min(at) FROM audit_events
                            WHERE tenant_id = t.id AND entity_type = 'User' AND entity_id IS NOT NULL AND project_id IS NOT NULL
                                AND action IN ('MEMBERSHIP_CHANGED', 'PERSON_JOINED_PROJECT')
                            GROUP BY entity_id, project_id
                        ON CONFLICT (user_id, project_id) DO UPDATE SET joined_at = EXCLUDED.joined_at;
                    END LOOP;
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // audit_append and audit_note keep calling audit_seen: it goes with them only if they are put back first.
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION audit_seen(p_tenant uuid, p_project uuid, p_actor uuid, p_action text,
                    p_entity_type text, p_entity_id uuid, p_at timestamptz) RETURNS void LANGUAGE sql AS $$ SELECT $$;
                """);
            migrationBuilder.DropTable(
                name: "people_seen");

            migrationBuilder.DropIndex(
                name: "ix_transmittal_items_document_id_kind",
                table: "transmittal_items");

            migrationBuilder.DropIndex(
                name: "ix_revisions_project_id_state",
                table: "revisions");

            migrationBuilder.DropIndex(
                name: "ix_notifications_user_id_project_id_created_at",
                table: "notifications");

            migrationBuilder.DropIndex(
                name: "ix_documents_latest_revision_id",
                table: "documents");

            migrationBuilder.DropIndex(
                name: "ix_audit_events_entity_id_id",
                table: "audit_events");

            migrationBuilder.DropIndex(
                name: "ix_audit_events_project_id_id",
                table: "audit_events");

            migrationBuilder.CreateIndex(
                name: "ix_transmittal_items_document_id",
                table: "transmittal_items",
                column: "document_id");
        }
    }
}
