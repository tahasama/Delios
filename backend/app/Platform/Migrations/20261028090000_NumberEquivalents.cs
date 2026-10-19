using Delios.Host.Tenancy;
﻿using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class NumberEquivalents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "matched",
                table: "transmittal_items",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Instant>(
                name: "returned_at",
                table: "transmittal_items",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "returned_by_name",
                table: "transmittal_items",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "returned_reason",
                table: "transmittal_items",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "their_outcome",
                table: "transmittal_items",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "their_status",
                table: "transmittal_items",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "their_outcome",
                table: "revisions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "their_status",
                table: "revisions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "as_received_at",
                table: "packages",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "as_received_by_name",
                table: "packages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "as_received_deliverable_type",
                table: "packages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "as_received_discipline",
                table: "packages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "as_received_doc_type",
                table: "packages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "takes_as_received",
                table: "packages",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "as_received",
                table: "documents",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "number_equivalents",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    party_id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    source = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    recorded_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    recorded_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    taken_back_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    taken_back_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    taken_back_reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_number_equivalents", x => x.id);
                    table.ForeignKey(
                        name: "fk_number_equivalents_documents_document_id",
                        column: x => x.document_id,
                        principalTable: "documents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_number_equivalents_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            RowLevelSecurity.Enable(migrationBuilder, "number_equivalents");

            migrationBuilder.CreateIndex(
                name: "ix_number_equivalents_document_id_party_id",
                table: "number_equivalents",
                columns: new[] { "document_id", "party_id" },
                unique: true,
                filter: "taken_back_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_number_equivalents_project_id_party_id_number",
                table: "number_equivalents",
                columns: new[] { "project_id", "party_id", "number" },
                unique: true,
                filter: "taken_back_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_number_equivalents_tenant_id",
                table: "number_equivalents",
                column: "tenant_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "number_equivalents");

            migrationBuilder.DropColumn(
                name: "matched",
                table: "transmittal_items");

            migrationBuilder.DropColumn(
                name: "returned_at",
                table: "transmittal_items");

            migrationBuilder.DropColumn(
                name: "returned_by_name",
                table: "transmittal_items");

            migrationBuilder.DropColumn(
                name: "returned_reason",
                table: "transmittal_items");

            migrationBuilder.DropColumn(
                name: "their_outcome",
                table: "transmittal_items");

            migrationBuilder.DropColumn(
                name: "their_status",
                table: "transmittal_items");

            migrationBuilder.DropColumn(
                name: "their_outcome",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "their_status",
                table: "revisions");

            migrationBuilder.DropColumn(
                name: "as_received_at",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "as_received_by_name",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "as_received_deliverable_type",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "as_received_discipline",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "as_received_doc_type",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "takes_as_received",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "as_received",
                table: "documents");
        }
    }
}
