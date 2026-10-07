using System;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class Identity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "audit_events",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    actor_id = table.Column<Guid>(type: "uuid", nullable: true),
                    actor_name = table.Column<string>(type: "text", nullable: false),
                    action = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    entity_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: true),
                    entity_label = table.Column<string>(type: "text", nullable: true),
                    detail = table.Column<string>(type: "text", nullable: true),
                    previous_hash = table.Column<byte[]>(type: "bytea", nullable: false),
                    hash = table.Column<byte[]>(type: "bytea", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_audit_events", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "sessions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_hash = table.Column<byte[]>(type: "bytea", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    revoked_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_sessions", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "tenants",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    slug = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tenants", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "functions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    active = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_functions", x => x.id);
                    table.ForeignKey(
                        name: "fk_functions_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "parties",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    is_internal = table.Column<bool>(type: "boolean", nullable: false),
                    active = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_parties", x => x.id);
                    table.ForeignKey(
                        name: "fk_parties_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "projects",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    contract_role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    time_zone = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_projects", x => x.id);
                    table.ForeignKey(
                        name: "fk_projects_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "permission_rules",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    function_id = table.Column<Guid>(type: "uuid", nullable: false),
                    deliverable_type = table.Column<string>(type: "text", nullable: true),
                    doc_type = table.Column<string>(type: "text", nullable: true),
                    discipline = table.Column<string>(type: "text", nullable: true),
                    criticality = table.Column<string>(type: "text", nullable: true),
                    confidentiality = table.Column<string>(type: "text", nullable: true),
                    project_role = table.Column<string>(type: "text", nullable: true),
                    verbs = table.Column<string[]>(type: "text[]", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_permission_rules", x => x.id);
                    table.ForeignKey(
                        name: "fk_permission_rules_functions_function_id",
                        column: x => x.function_id,
                        principalTable: "functions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_permission_rules_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    normalized_email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    password_hash = table.Column<string>(type: "text", nullable: false),
                    party_id = table.Column<Guid>(type: "uuid", nullable: true),
                    active = table.Column<bool>(type: "boolean", nullable: false),
                    is_admin = table.Column<bool>(type: "boolean", nullable: false),
                    failed_sign_ins = table.Column<int>(type: "integer", nullable: false),
                    locked_until = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_users", x => x.id);
                    table.ForeignKey(
                        name: "fk_users_parties_party_id",
                        column: x => x.party_id,
                        principalTable: "parties",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_users_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "memberships",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    function_id = table.Column<Guid>(type: "uuid", nullable: false),
                    department = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    active = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_memberships", x => x.id);
                    table.ForeignKey(
                        name: "fk_memberships_functions_function_id",
                        column: x => x.function_id,
                        principalTable: "functions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_memberships_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_memberships_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_memberships_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_audit_events_entity_type_entity_id",
                table: "audit_events",
                columns: new[] { "entity_type", "entity_id" });

            migrationBuilder.CreateIndex(
                name: "ix_audit_events_project_id",
                table: "audit_events",
                column: "project_id");

            migrationBuilder.CreateIndex(
                name: "ix_audit_events_tenant_id_id",
                table: "audit_events",
                columns: new[] { "tenant_id", "id" });

            migrationBuilder.CreateIndex(
                name: "ix_functions_tenant_id_code",
                table: "functions",
                columns: new[] { "tenant_id", "code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_memberships_function_id",
                table: "memberships",
                column: "function_id");

            migrationBuilder.CreateIndex(
                name: "ix_memberships_project_id_user_id",
                table: "memberships",
                columns: new[] { "project_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_memberships_tenant_id",
                table: "memberships",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_memberships_user_id",
                table: "memberships",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_parties_tenant_id_code",
                table: "parties",
                columns: new[] { "tenant_id", "code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_permission_rules_function_id",
                table: "permission_rules",
                column: "function_id");

            migrationBuilder.CreateIndex(
                name: "ix_permission_rules_tenant_id",
                table: "permission_rules",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_projects_tenant_id_code",
                table: "projects",
                columns: new[] { "tenant_id", "code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_sessions_token_hash",
                table: "sessions",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_sessions_user_id",
                table: "sessions",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_tenants_slug",
                table: "tenants",
                column: "slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_users_party_id",
                table: "users",
                column: "party_id");

            migrationBuilder.CreateIndex(
                name: "ix_users_tenant_id_normalized_email",
                table: "users",
                columns: new[] { "tenant_id", "normalized_email" },
                unique: true);

            RowLevelSecurity.Enable(migrationBuilder,
                "parties", "users", "projects", "functions", "permission_rules", "memberships", "audit_events");

            // The audit trail: written only through audit_append, which stamps the
            // time from the database clock and chains each row to the tenant's
            // previous one. Rows can never be changed or removed.
            migrationBuilder.Sql("""
                CREATE FUNCTION audit_canonical(
                    p_tenant uuid, p_project uuid, p_at timestamptz, p_actor uuid, p_actor_name text,
                    p_action text, p_entity_type text, p_entity_id uuid, p_entity_label text, p_detail text)
                RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
                    SELECT convert_to(concat_ws(E'\x1f',
                        p_tenant::text, coalesce(p_project::text, ''),
                        to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                        coalesce(p_actor::text, ''), p_actor_name, p_action,
                        coalesce(p_entity_type, ''), coalesce(p_entity_id::text, ''),
                        coalesce(p_entity_label, ''), coalesce(p_detail, '')), 'UTF8')
                $$;

                CREATE FUNCTION audit_append(
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
                        WHERE tenant_id = p_tenant ORDER BY id DESC LIMIT 1;
                    v_previous := coalesce(v_previous, ''::bytea);
                    INSERT INTO audit_events (tenant_id, project_id, at, actor_id, actor_name, action,
                        entity_type, entity_id, entity_label, detail, previous_hash, hash)
                    VALUES (p_tenant, p_project, v_at, p_actor, p_actor_name, p_action,
                        p_entity_type, p_entity_id, p_entity_label, p_detail, v_previous,
                        sha256(v_previous || audit_canonical(p_tenant, p_project, v_at, p_actor, p_actor_name,
                            p_action, p_entity_type, p_entity_id, p_entity_label, p_detail)));
                END
                $$;

                CREATE FUNCTION audit_verify(p_tenant uuid) RETURNS bigint LANGUAGE plpgsql STABLE AS $$
                DECLARE
                    r audit_events%ROWTYPE;
                    v_previous bytea := ''::bytea;
                BEGIN
                    FOR r IN SELECT * FROM audit_events WHERE tenant_id = p_tenant ORDER BY id LOOP
                        IF r.previous_hash <> v_previous
                            OR r.hash <> sha256(v_previous || audit_canonical(r.tenant_id, r.project_id, r.at,
                                r.actor_id, r.actor_name, r.action, r.entity_type, r.entity_id, r.entity_label, r.detail))
                        THEN
                            RETURN r.id;
                        END IF;
                        v_previous := r.hash;
                    END LOOP;
                    RETURN NULL;
                END
                $$;

                CREATE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION 'audit_events is append-only';
                END
                $$;

                CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
                    FOR EACH ROW EXECUTE FUNCTION audit_append_only();
                CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
                    FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
                DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
                DROP FUNCTION IF EXISTS audit_append_only();
                DROP FUNCTION IF EXISTS audit_verify(uuid);
                DROP FUNCTION IF EXISTS audit_append(uuid, uuid, uuid, text, text, text, uuid, text, text);
                DROP FUNCTION IF EXISTS audit_canonical(uuid, uuid, timestamptz, uuid, text, text, text, uuid, text, text);
                """);
            RowLevelSecurity.Disable(migrationBuilder,
                "parties", "users", "projects", "functions", "permission_rules", "memberships", "audit_events");

            migrationBuilder.DropTable(
                name: "audit_events");

            migrationBuilder.DropTable(
                name: "memberships");

            migrationBuilder.DropTable(
                name: "permission_rules");

            migrationBuilder.DropTable(
                name: "sessions");

            migrationBuilder.DropTable(
                name: "projects");

            migrationBuilder.DropTable(
                name: "users");

            migrationBuilder.DropTable(
                name: "functions");

            migrationBuilder.DropTable(
                name: "parties");

            migrationBuilder.DropTable(
                name: "tenants");
        }
    }
}
