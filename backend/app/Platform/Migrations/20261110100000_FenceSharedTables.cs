using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>
    /// The last eight tables holding an organization's id get row-level security too, with one explicit door across
    /// (<c>Tenancy.Crossing</c>, <c>app.crossing</c>). Inside an organization's transaction: sessions, product requests,
    /// notice alarms and reply addresses show and take only its own rows; the shared registry (sign-in names, reserved
    /// values, organization identities and holders), read across by design (one email, one code, one name on DELIOS), is
    /// read by all but written only for itself, or through the door. With no organization set (before sign-in, the
    /// worker, a command) nothing changes.
    /// </summary>
    [DbContext(typeof(DeliosDbContext))]
    [Migration("20261110100000_FenceSharedTables")]
    public partial class FenceSharedTables : Migration
    {
        private const string Current = "NULLIF(current_setting('app.tenant_id', true), '')::uuid";
        private const string Open = $"({Current} IS NULL OR current_setting('app.crossing', true) = 'on')";
        private static readonly string[] Own = ["sessions", "product_requests", "notice_alarms", "reply_addresses"];
        private static readonly string[] Shared = ["sign_in_names", "reserved_values", "organization_identities", "organization_holders"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            foreach (var table in Own)
                migrationBuilder.Sql($"""
                    ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
                    ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
                    CREATE POLICY tenant_isolation ON {table}
                        USING ({Open} OR tenant_id = {Current})
                        WITH CHECK ({Open} OR tenant_id = {Current});
                    """);
            foreach (var table in Shared)
                migrationBuilder.Sql($"""
                    ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
                    ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
                    CREATE POLICY shared_read ON {table} FOR SELECT USING (true);
                    CREATE POLICY own_insert ON {table} FOR INSERT
                        WITH CHECK ({Open} OR tenant_id IS NULL OR tenant_id = {Current});
                    CREATE POLICY own_update ON {table} FOR UPDATE
                        USING ({Open} OR tenant_id IS NULL OR tenant_id = {Current})
                        WITH CHECK ({Open} OR tenant_id IS NULL OR tenant_id = {Current});
                    CREATE POLICY own_delete ON {table} FOR DELETE
                        USING ({Open} OR tenant_id IS NULL OR tenant_id = {Current});
                    """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var table in Own)
                migrationBuilder.Sql($"""
                    DROP POLICY IF EXISTS tenant_isolation ON {table};
                    ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;
                    ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;
                    """);
            foreach (var table in Shared)
                migrationBuilder.Sql($"""
                    DROP POLICY IF EXISTS shared_read ON {table};
                    DROP POLICY IF EXISTS own_insert ON {table};
                    DROP POLICY IF EXISTS own_update ON {table};
                    DROP POLICY IF EXISTS own_delete ON {table};
                    ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;
                    ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;
                    """);
        }
    }
}
