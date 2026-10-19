using Delios.Host.Tenancy;
﻿using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class KeptCopies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "kept_copies",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    payload = table.Column<string>(type: "jsonb", nullable: false),
                    kept_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    kept_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    put_back_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    put_back_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    put_back_reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_kept_copies", x => x.id);
                    table.ForeignKey(
                        name: "fk_kept_copies_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            RowLevelSecurity.Enable(migrationBuilder, "kept_copies");

            migrationBuilder.CreateIndex(
                name: "ix_kept_copies_project_id_kind",
                table: "kept_copies",
                columns: new[] { "project_id", "kind" });

            migrationBuilder.CreateIndex(
                name: "ix_kept_copies_tenant_id",
                table: "kept_copies",
                column: "tenant_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "kept_copies");
        }
    }
}
