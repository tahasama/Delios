using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class OnePersonOneOrganization : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "sign_in_names",
                columns: table => new
                {
                    normalized_email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_sign_in_names", x => x.normalized_email);
                    table.ForeignKey(
                        name: "fk_sign_in_names_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_sign_in_names_tenant_id",
                table: "sign_in_names",
                column: "tenant_id");

            // A person signs in with their email alone, so the email names one organization. The trigger keeps this
            // table in step with users; it is read before anyone is known, so it has no row-level security and holds
            // only the email and the organization.
            migrationBuilder.Sql("""
                CREATE FUNCTION users_sign_in_name() RETURNS trigger LANGUAGE plpgsql AS $$
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
                CREATE TRIGGER users_sign_in_name AFTER INSERT OR UPDATE OF normalized_email, tenant_id OR DELETE ON users
                    FOR EACH ROW EXECUTE FUNCTION users_sign_in_name();

                -- The people already there, organization by organization (users are only visible to their own).
                DO $$
                DECLARE t record;
                BEGIN
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        INSERT INTO sign_in_names (normalized_email, tenant_id)
                            SELECT normalized_email, tenant_id FROM users WHERE tenant_id = t.id
                            ON CONFLICT DO NOTHING;
                    END LOOP;
                    PERFORM set_config('app.tenant_id', '', true);
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS users_sign_in_name ON users;
                DROP FUNCTION IF EXISTS users_sign_in_name();
                """);
            migrationBuilder.DropTable(
                name: "sign_in_names");
        }
    }
}
