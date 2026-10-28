using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    /// <summary>
    /// The DELIOS team's console (Operators): its accounts and sessions, what each organization has with us, plans, the
    /// legal texts, acceptances, legal matters, support access and the team's log. Kept outside every organization's data:
    /// no row-level security. And how long activity is kept (audit_prune).
    /// </summary>
    public partial class OperatorsConsole : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "legal_acceptances",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    user_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    address = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_legal_acceptances", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "legal_documents",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    body = table.Column<string>(type: "text", nullable: false),
                    note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    published_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    published_by = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_legal_documents", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "legal_matters",
                columns: table => new
                {
                    key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    note = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    updated_by = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_legal_matters", x => x.key);
                });

            migrationBuilder.CreateTable(
                name: "operator_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    operator_id = table.Column<Guid>(type: "uuid", nullable: false),
                    operator_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    action = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: true),
                    detail = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_operator_events", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "operator_sessions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_hash = table.Column<byte[]>(type: "bytea", nullable: false),
                    operator_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    revoked_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_operator_sessions", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "operators",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    normalized_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    password_hash = table.Column<string>(type: "text", nullable: false),
                    mfa_secret_protected = table.Column<string>(type: "text", nullable: false),
                    mfa_last_step = table.Column<long>(type: "bigint", nullable: true),
                    active = table.Column<bool>(type: "boolean", nullable: false),
                    failed_sign_ins = table.Column<int>(type: "integer", nullable: false),
                    locked_until = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    last_sign_in_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_operators", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "plans",
                columns: table => new
                {
                    code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    price_per_user = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: true),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    active = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_plans", x => x.code);
                });

            migrationBuilder.CreateTable(
                name: "subscriptions",
                columns: table => new
                {
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plan = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    state = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    trial_ends_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    paid_until = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    billing = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    seats = table.Column<int>(type: "integer", nullable: true),
                    contract_ref = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    contract_signed_on = table.Column<LocalDate>(type: "date", nullable: true),
                    provider_ref = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    notes = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    cancelled_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    cancelled_by = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    updated_by = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_subscriptions", x => x.tenant_id);
                });

            migrationBuilder.CreateTable(
                name: "support_grants",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    granted_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    granted_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    why = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    from = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    until = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    ended_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    ended_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_support_grants", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_legal_acceptances_tenant_id_kind_version",
                table: "legal_acceptances",
                columns: new[] { "tenant_id", "kind", "version" });

            migrationBuilder.CreateIndex(
                name: "ix_legal_documents_kind_version",
                table: "legal_documents",
                columns: new[] { "kind", "version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_operator_events_at",
                table: "operator_events",
                column: "at");

            migrationBuilder.CreateIndex(
                name: "ix_operator_events_tenant_id",
                table: "operator_events",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_operator_sessions_token_hash",
                table: "operator_sessions",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_operators_normalized_email",
                table: "operators",
                column: "normalized_email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_support_grants_tenant_id",
                table: "support_grants",
                column: "tenant_id");

            // How long activity is kept: what was opened and downloaded (outside the chain, each row sealed alone) may be
            // removed past the organization's TRACK_KEEP_DAYS, by audit_prune only; every other row stays append-only.
            migrationBuilder.Sql("""
                CREATE INDEX ix_audit_events_tenant_at_reading ON audit_events (tenant_id, at) WHERE NOT chained;

                CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF TG_OP = 'DELETE' AND NOT OLD.chained AND current_setting('app.audit_prune', true) = 'on' THEN
                        RETURN OLD;
                    END IF;
                    RAISE EXCEPTION 'audit_events is append-only';
                END
                $$;

                CREATE FUNCTION audit_prune(p_tenant uuid) RETURNS integer LANGUAGE plpgsql AS $$
                DECLARE
                    v_days integer;
                    v_removed integer;
                BEGIN
                    SELECT CASE WHEN value ~ '^[0-9]{1,5}$' THEN value::integer END INTO v_days
                        FROM settings WHERE tenant_id = p_tenant AND project_id IS NULL AND key = 'TRACK_KEEP_DAYS' LIMIT 1;
                    IF v_days IS NULL OR v_days < 1 THEN
                        RETURN 0;
                    END IF;
                    PERFORM set_config('app.audit_prune', 'on', true);
                    DELETE FROM audit_events WHERE tenant_id = p_tenant AND NOT chained AND at < now() - make_interval(days => v_days);
                    GET DIAGNOSTICS v_removed = ROW_COUNT;
                    PERFORM set_config('app.audit_prune', 'off', true);
                    RETURN v_removed;
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP FUNCTION IF EXISTS audit_prune(uuid);
                DROP INDEX IF EXISTS ix_audit_events_tenant_at_reading;
                CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION 'audit_events is append-only';
                END
                $$;
                """);

            migrationBuilder.DropTable(
                name: "legal_acceptances");

            migrationBuilder.DropTable(
                name: "legal_documents");

            migrationBuilder.DropTable(
                name: "legal_matters");

            migrationBuilder.DropTable(
                name: "operator_events");

            migrationBuilder.DropTable(
                name: "operator_sessions");

            migrationBuilder.DropTable(
                name: "operators");

            migrationBuilder.DropTable(
                name: "plans");

            migrationBuilder.DropTable(
                name: "subscriptions");

            migrationBuilder.DropTable(
                name: "support_grants");
        }
    }
}
