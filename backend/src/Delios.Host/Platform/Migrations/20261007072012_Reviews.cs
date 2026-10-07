using System;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class Reviews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "derived_from_id",
                table: "stored_files",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "released_at",
                table: "revisions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "released_by_name",
                table: "revisions",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "returned_at",
                table: "revisions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "returned_reason",
                table: "revisions",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "status_code",
                table: "revisions",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "superseded_at",
                table: "revisions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int[]>(
                name: "weekend_days",
                table: "projects",
                type: "integer[]",
                nullable: false,
                // Existing projects keep a Saturday–Sunday weekend until someone sets theirs.
                defaultValue: new[] { 6, 7 });

            migrationBuilder.CreateTable(
                name: "review_routes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    is_default = table.Column<bool>(type: "boolean", nullable: false),
                    active = table.Column<bool>(type: "boolean", nullable: false),
                    patterns = table.Column<string>(type: "jsonb", nullable: true),
                    steps = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_review_routes", x => x.id);
                    table.ForeignKey(
                        name: "fk_review_routes_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "reviews",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    revision_id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    route_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    state = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    current_step = table.Column<int>(type: "integer", nullable: false),
                    verdict = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    granted_status = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    started_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    started_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    started_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    decided_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    closed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    closed_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    return_reason = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    return_note = table.Column<string>(type: "text", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_reviews", x => x.id);
                    table.ForeignKey(
                        name: "fk_reviews_documents_document_id",
                        column: x => x.document_id,
                        principalTable: "documents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_reviews_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_reviews_revisions_revision_id",
                        column: x => x.revision_id,
                        principalTable: "revisions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_reviews_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "review_comments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    review_id = table.Column<Guid>(type: "uuid", nullable: false),
                    step_index = table.Column<int>(type: "integer", nullable: false),
                    author_id = table.Column<Guid>(type: "uuid", nullable: false),
                    author_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    text = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    @class = table.Column<string>(name: "class", type: "character varying(64)", maxLength: 64, nullable: false),
                    blocking = table.Column<bool>(type: "boolean", nullable: false),
                    closes_with = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    closes_with_step = table.Column<int>(type: "integer", nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    resolution = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    closed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    closed_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_review_comments", x => x.id);
                    table.ForeignKey(
                        name: "fk_review_comments_reviews_review_id",
                        column: x => x.review_id,
                        principalTable: "reviews",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_review_comments_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "review_steps",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    review_id = table.Column<Guid>(type: "uuid", nullable: false),
                    index = table.Column<int>(type: "integer", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    function_code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    mode = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    deciding = table.Column<bool>(type: "boolean", nullable: false),
                    days = table.Column<int>(type: "integer", nullable: true),
                    grants_statuses = table.Column<string[]>(type: "text[]", nullable: false),
                    state = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    opened_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    due_date = table.Column<LocalDate>(type: "date", nullable: true),
                    completed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    answer = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_review_steps", x => x.id);
                    table.ForeignKey(
                        name: "fk_review_steps_reviews_review_id",
                        column: x => x.review_id,
                        principalTable: "reviews",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_review_steps_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "review_participants",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    step_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    answer = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    granted_status = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    note = table.Column<string>(type: "text", nullable: true),
                    answered_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_review_participants", x => x.id);
                    table.ForeignKey(
                        name: "fk_review_participants_review_steps_step_id",
                        column: x => x.step_id,
                        principalTable: "review_steps",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_review_participants_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_review_participants_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_stored_files_derived_from_id",
                table: "stored_files",
                column: "derived_from_id");

            migrationBuilder.CreateIndex(
                name: "ix_review_comments_review_id_status",
                table: "review_comments",
                columns: new[] { "review_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_review_comments_tenant_id",
                table: "review_comments",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_review_participants_step_id_user_id",
                table: "review_participants",
                columns: new[] { "step_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_review_participants_tenant_id",
                table: "review_participants",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_review_participants_user_id_answered_at",
                table: "review_participants",
                columns: new[] { "user_id", "answered_at" });

            migrationBuilder.CreateIndex(
                name: "ix_review_routes_tenant_id_name",
                table: "review_routes",
                columns: new[] { "tenant_id", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_review_steps_review_id_index",
                table: "review_steps",
                columns: new[] { "review_id", "index" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_review_steps_tenant_id_state",
                table: "review_steps",
                columns: new[] { "tenant_id", "state" });

            migrationBuilder.CreateIndex(
                name: "ix_reviews_document_id",
                table: "reviews",
                column: "document_id");

            migrationBuilder.CreateIndex(
                name: "ix_reviews_project_id_number",
                table: "reviews",
                columns: new[] { "project_id", "number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_reviews_project_id_state",
                table: "reviews",
                columns: new[] { "project_id", "state" });

            migrationBuilder.CreateIndex(
                name: "ix_reviews_revision_id",
                table: "reviews",
                column: "revision_id");

            migrationBuilder.CreateIndex(
                name: "ix_reviews_tenant_id",
                table: "reviews",
                column: "tenant_id");

            RowLevelSecurity.Enable(migrationBuilder, "review_routes", "reviews", "review_steps", "review_participants", "review_comments");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            RowLevelSecurity.Disable(migrationBuilder, "review_routes", "reviews", "review_steps", "review_participants", "review_comments");
            migrationBuilder.DropTable(
                name: "review_comments");

            migrationBuilder.DropTable(
                name: "review_participants");

            migrationBuilder.DropTable(
                name: "review_routes");

            migrationBuilder.DropTable(
                name: "review_steps");

            migrationBuilder.DropTable(
                name: "reviews");

            migrationBuilder.DropIndex(
                name: "ix_stored_files_derived_from_id",
                table: "stored_files");

            migrationBuilder.DropColumn(
                name: "derived_from_id",
                table: "stored_files");

            migrationBuilder.DropColumn(
                name: "released_at",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "released_by_name",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "returned_at",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "returned_reason",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "status_code",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "superseded_at",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "weekend_days",
                table: "projects");
        }
    }
}
