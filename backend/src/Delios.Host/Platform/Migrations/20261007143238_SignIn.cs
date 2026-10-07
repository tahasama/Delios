using System;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class SignIn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Instant>(
                name: "mfa_enabled_at",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "mfa_last_step",
                table: "users",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "mfa_secret_protected",
                table: "users",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string[]>(
                name: "recovery_code_hashes",
                table: "users",
                type: "text[]",
                nullable: false,
                defaultValue: new string[0]);

            migrationBuilder.AddColumn<bool>(
                name: "mfa_required",
                table: "tenants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "password_sign_in",
                table: "tenants",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "identity_providers",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    authority = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    client_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    client_secret_protected = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    scopes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    allowed_domains = table.Column<string[]>(type: "text[]", nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_identity_providers", x => x.id);
                    table.ForeignKey(
                        name: "fk_identity_providers_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_identity_providers_tenant_id",
                table: "identity_providers",
                column: "tenant_id",
                unique: true);

            RowLevelSecurity.Enable(migrationBuilder, "identity_providers");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            RowLevelSecurity.Disable(migrationBuilder, "identity_providers");

            migrationBuilder.DropTable(
                name: "identity_providers");

            migrationBuilder.DropColumn(
                name: "mfa_enabled_at",
                table: "users");

            migrationBuilder.DropColumn(
                name: "mfa_last_step",
                table: "users");

            migrationBuilder.DropColumn(
                name: "mfa_secret_protected",
                table: "users");

            migrationBuilder.DropColumn(
                name: "recovery_code_hashes",
                table: "users");

            migrationBuilder.DropColumn(
                name: "mfa_required",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "password_sign_in",
                table: "tenants");
        }
    }
}
