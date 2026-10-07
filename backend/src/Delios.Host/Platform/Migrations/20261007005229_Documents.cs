using System;
using System.Text.Json;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class Documents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "documents",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    deliverable_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    doc_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    discipline = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    originator = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    subproject = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    contract_ref = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    criticality = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    confidentiality = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    retention_class = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    state = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    is_placeholder = table.Column<bool>(type: "boolean", nullable: false),
                    received_date = table.Column<LocalDate>(type: "date", nullable: true),
                    planned_date = table.Column<LocalDate>(type: "date", nullable: true),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    latest_revision_id = table.Column<Guid>(type: "uuid", nullable: true),
                    latest_revision_value = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    latest_revision_state = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_documents", x => x.id);
                    table.ForeignKey(
                        name: "fk_documents_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_documents_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "idempotency_records",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    endpoint = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    request_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    status_code = table.Column<int>(type: "integer", nullable: false),
                    body = table.Column<string>(type: "jsonb", nullable: true),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_idempotency_records", x => x.id);
                    table.ForeignKey(
                        name: "fk_idempotency_records_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "number_counters",
                columns: table => new
                {
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    prefix = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    next = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_number_counters", x => new { x.project_id, x.prefix });
                    table.ForeignKey(
                        name: "fk_number_counters_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_number_counters_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "numbering_schemes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    delimiter = table.Column<string>(type: "character varying(4)", maxLength: 4, nullable: false),
                    active = table.Column<bool>(type: "boolean", nullable: false),
                    fields = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_numbering_schemes", x => x.id);
                    table.ForeignKey(
                        name: "fk_numbering_schemes_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "outbox_messages",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    routing_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    payload = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    sent_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_outbox_messages", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "value_entries",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    set_key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    label = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    sort = table.Column<int>(type: "integer", nullable: false),
                    props = table.Column<JsonDocument>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_value_entries", x => x.id);
                    table.ForeignKey(
                        name: "fk_value_entries_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "document_access",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    added_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_document_access", x => x.id);
                    table.ForeignKey(
                        name: "fk_document_access_documents_document_id",
                        column: x => x.document_id,
                        principalTable: "documents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_document_access_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_document_access_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "revisions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    value = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    series = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    state = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    files_state = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    reason_for_revision = table.Column<string>(type: "text", nullable: true),
                    change_description = table.Column<string>(type: "text", nullable: true),
                    authored_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    authored_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    authored_by_party = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_revisions", x => x.id);
                    table.ForeignKey(
                        name: "fk_revisions_documents_document_id",
                        column: x => x.document_id,
                        principalTable: "documents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_revisions_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "scheme_routings",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    deliverable_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    scheme_id = table.Column<Guid>(type: "uuid", nullable: false),
                    active = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_scheme_routings", x => x.id);
                    table.ForeignKey(
                        name: "fk_scheme_routings_numbering_schemes_scheme_id",
                        column: x => x.scheme_id,
                        principalTable: "numbering_schemes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_scheme_routings_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "stored_files",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    revision_id = table.Column<Guid>(type: "uuid", nullable: true),
                    object_key = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    content_type = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    size = table.Column<long>(type: "bigint", nullable: false),
                    sha256 = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    detected_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    status_detail = table.Column<string>(type: "text", nullable: true),
                    uploaded_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    uploaded_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    scanned_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_stored_files", x => x.id);
                    table.ForeignKey(
                        name: "fk_stored_files_documents_document_id",
                        column: x => x.document_id,
                        principalTable: "documents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_stored_files_revisions_revision_id",
                        column: x => x.revision_id,
                        principalTable: "revisions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_stored_files_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_document_access_document_id_user_id",
                table: "document_access",
                columns: new[] { "document_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_document_access_tenant_id",
                table: "document_access",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_document_access_user_id",
                table: "document_access",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_documents_project_id_discipline",
                table: "documents",
                columns: new[] { "project_id", "discipline" });

            migrationBuilder.CreateIndex(
                name: "ix_documents_project_id_doc_type",
                table: "documents",
                columns: new[] { "project_id", "doc_type" });

            migrationBuilder.CreateIndex(
                name: "ix_documents_project_id_number",
                table: "documents",
                columns: new[] { "project_id", "number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_documents_project_id_originator",
                table: "documents",
                columns: new[] { "project_id", "originator" });

            migrationBuilder.CreateIndex(
                name: "ix_documents_project_id_state",
                table: "documents",
                columns: new[] { "project_id", "state" });

            migrationBuilder.CreateIndex(
                name: "ix_documents_tenant_id",
                table: "documents",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_idempotency_records_tenant_id_user_id_key",
                table: "idempotency_records",
                columns: new[] { "tenant_id", "user_id", "key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_number_counters_tenant_id",
                table: "number_counters",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_numbering_schemes_tenant_id_name",
                table: "numbering_schemes",
                columns: new[] { "tenant_id", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_outbox_messages_unsent",
                table: "outbox_messages",
                column: "id",
                filter: "sent_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_revisions_document_id_value",
                table: "revisions",
                columns: new[] { "document_id", "value" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_revisions_tenant_id",
                table: "revisions",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_scheme_routings_scheme_id",
                table: "scheme_routings",
                column: "scheme_id");

            migrationBuilder.CreateIndex(
                name: "ix_scheme_routings_tenant_id_deliverable_type",
                table: "scheme_routings",
                columns: new[] { "tenant_id", "deliverable_type" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_stored_files_document_id",
                table: "stored_files",
                column: "document_id");

            migrationBuilder.CreateIndex(
                name: "ix_stored_files_object_key",
                table: "stored_files",
                column: "object_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_stored_files_revision_id",
                table: "stored_files",
                column: "revision_id");

            migrationBuilder.CreateIndex(
                name: "ix_stored_files_tenant_id",
                table: "stored_files",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_value_entries_tenant_id_set_key_code",
                table: "value_entries",
                columns: new[] { "tenant_id", "set_key", "code" },
                unique: true);

            RowLevelSecurity.Enable(migrationBuilder,
                "value_entries", "numbering_schemes", "scheme_routings", "number_counters", "documents", "revisions", "stored_files", "document_access", "idempotency_records");

            // Register search: partial matches on number and title stay indexed.
            migrationBuilder.Sql("""
                CREATE EXTENSION IF NOT EXISTS pg_trgm;
                CREATE INDEX ix_documents_number_trgm ON documents USING gin (number gin_trgm_ops);
                CREATE INDEX ix_documents_title_trgm ON documents USING gin (title gin_trgm_ops);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP INDEX IF EXISTS ix_documents_number_trgm;
                DROP INDEX IF EXISTS ix_documents_title_trgm;
                """);
            RowLevelSecurity.Disable(migrationBuilder,
                "value_entries", "numbering_schemes", "scheme_routings", "number_counters", "documents", "revisions", "stored_files", "document_access", "idempotency_records");

            migrationBuilder.DropTable(
                name: "document_access");

            migrationBuilder.DropTable(
                name: "idempotency_records");

            migrationBuilder.DropTable(
                name: "number_counters");

            migrationBuilder.DropTable(
                name: "outbox_messages");

            migrationBuilder.DropTable(
                name: "scheme_routings");

            migrationBuilder.DropTable(
                name: "stored_files");

            migrationBuilder.DropTable(
                name: "value_entries");

            migrationBuilder.DropTable(
                name: "numbering_schemes");

            migrationBuilder.DropTable(
                name: "revisions");

            migrationBuilder.DropTable(
                name: "documents");
        }
    }
}
