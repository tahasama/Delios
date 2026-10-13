using Delios.Host.Tenancy;
using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class SupplierHolder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "relocked_at",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "relocked_by_name",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "unlock_reason",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "unlocked_at",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "unlocked_by_name",
                table: "documents");

            migrationBuilder.AddColumn<bool>(
                name: "with_supplier",
                table: "documents",
                type: "boolean",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "hand_back_requests",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    from_supplier = table.Column<bool>(type: "boolean", nullable: false),
                    asked_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    asked_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    asked_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    answered_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    answered_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    accepted = table.Column<bool>(type: "boolean", nullable: true),
                    answer = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_hand_back_requests", x => x.id);
                    table.ForeignKey(
                        name: "fk_hand_back_requests_documents_document_id",
                        column: x => x.document_id,
                        principalTable: "documents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_hand_back_requests_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_hand_back_requests_document_id_asked_at",
                table: "hand_back_requests",
                columns: new[] { "document_id", "asked_at" });

            migrationBuilder.CreateIndex(
                name: "ix_hand_back_requests_project_id_answered_at",
                table: "hand_back_requests",
                columns: new[] { "project_id", "answered_at" });

            migrationBuilder.CreateIndex(
                name: "ix_hand_back_requests_tenant_id",
                table: "hand_back_requests",
                column: "tenant_id");

            RowLevelSecurity.Enable(migrationBuilder, "hand_back_requests");

            // Documents already asked of a supplier: with them while nothing came back, or after a return (by the check,
            // or by a review); with us otherwise. An organization's verdict with comments released before this keeps
            // the document with us; Document Control sends it to the supplier for the update.
            migrationBuilder.Sql("""
                DO $$
                DECLARE t record;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        UPDATE documents d
                        SET with_supplier = (d.latest_revision_state IS NULL OR d.latest_revision_state IN ('CORRECTING', 'RETURNED'))
                        WHERE d.tenant_id = t.id
                          AND EXISTS (SELECT 1 FROM transmittal_items i WHERE i.document_id = d.id AND i.kind = 'PLACEHOLDER');
                    END LOOP;
                    PERFORM set_config('app.tenant_id', '', true);
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            RowLevelSecurity.Disable(migrationBuilder, "hand_back_requests");

            migrationBuilder.DropTable(
                name: "hand_back_requests");

            migrationBuilder.DropColumn(
                name: "with_supplier",
                table: "documents");

            migrationBuilder.AddColumn<Instant>(
                name: "relocked_at",
                table: "documents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "relocked_by_name",
                table: "documents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "unlock_reason",
                table: "documents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "unlocked_at",
                table: "documents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "unlocked_by_name",
                table: "documents",
                type: "text",
                nullable: true);
        }
    }
}
