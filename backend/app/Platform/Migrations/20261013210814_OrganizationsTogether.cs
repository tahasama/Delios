using System;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class OrganizationsTogether : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "home_tenant_id",
                table: "users",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "account_links",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    link_id = table.Column<Guid>(type: "uuid", nullable: false),
                    home_tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    home_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    host_tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    host_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    ended_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_account_links", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "organization_links",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    host_tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    host_party_id = table.Column<Guid>(type: "uuid", nullable: false),
                    host_party_code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    host_party_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    guest_tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    invited_email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    state = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    invited_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    invited_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    answered_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    answered_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    answer_note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    ended_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    ended_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ended_by_side = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    end_reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organization_links", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "project_parties",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    party_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    start_function_id = table.Column<Guid>(type: "uuid", nullable: true),
                    active = table.Column<bool>(type: "boolean", nullable: false),
                    added_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    added_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_project_parties", x => x.id);
                    table.ForeignKey(
                        name: "fk_project_parties_functions_start_function_id",
                        column: x => x.start_function_id,
                        principalTable: "functions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "fk_project_parties_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_account_links_home_user_id",
                table: "account_links",
                column: "home_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_account_links_host_user_id",
                table: "account_links",
                column: "host_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_account_links_link_id_home_user_id",
                table: "account_links",
                columns: new[] { "link_id", "home_user_id" },
                unique: true,
                filter: "ended_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_organization_links_guest_tenant_id",
                table: "organization_links",
                column: "guest_tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_organization_links_host_party_id",
                table: "organization_links",
                column: "host_party_id",
                unique: true,
                filter: "state IN ('INVITED', 'LINKED')");

            migrationBuilder.CreateIndex(
                name: "ix_organization_links_host_tenant_id",
                table: "organization_links",
                column: "host_tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_project_parties_project_id_party_id",
                table: "project_parties",
                columns: new[] { "project_id", "party_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_project_parties_start_function_id",
                table: "project_parties",
                column: "start_function_id");

            RowLevelSecurity.Enable(migrationBuilder, "project_parties");

            // A linked account stands for someone who signs in at home: it gets no sign-in name here, so the same email
            // can be theirs at home and stand for them in every organization whose projects they work on.
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION users_sign_in_name() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.home_tenant_id IS NULL THEN
                        DELETE FROM sign_in_names WHERE normalized_email = OLD.normalized_email AND tenant_id = OLD.tenant_id;
                    END IF;
                    IF TG_OP IN ('INSERT', 'UPDATE') THEN
                        IF NEW.home_tenant_id IS NULL THEN
                            INSERT INTO sign_in_names (normalized_email, tenant_id) VALUES (NEW.normalized_email, NEW.tenant_id);
                        END IF;
                        RETURN NEW;
                    END IF;
                    RETURN OLD;
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION users_sign_in_name() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF TG_OP IN ('UPDATE', 'DELETE') THEN
                        DELETE FROM sign_in_names WHERE normalized_email = OLD.normalized_email AND tenant_id = OLD.tenant_id;
                    END IF;
                    IF TG_OP IN ('INSERT', 'UPDATE') THEN
                        INSERT INTO sign_in_names (normalized_email, tenant_id) VALUES (NEW.normalized_email, NEW.tenant_id);
                        RETURN NEW;
                    END IF;
                    RETURN OLD;
                END
                $$;
                """);

            migrationBuilder.DropTable(
                name: "account_links");

            migrationBuilder.DropTable(
                name: "organization_links");

            migrationBuilder.DropTable(
                name: "project_parties");

            migrationBuilder.DropColumn(
                name: "home_tenant_id",
                table: "users");
        }
    }
}
