using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class AppCheckNumbers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The checks are numbered by the app (SET, DOC, REV, RVW, STO, SCH, PKG): what was found and what was switched
            // off keep their history under the new number. Row-level security is forced, so each organization in turn.
            migrationBuilder.Sql("""
                DO $$
                DECLARE t record;
                BEGIN
                    CREATE TEMP TABLE check_renumber(old text, new text) ON COMMIT DROP;
                    INSERT INTO check_renumber VALUES ('ID-05','SET-01'),('ST-04','SET-02'),('ST-06','SET-03'),('RO-01','SET-04'),('RO-03','SET-05'),('CL-06','SET-06'),('CL-07','SET-07'),('RT-01','SET-08'),('IS-06','SET-09'),('IS-09','SET-10'),('SC-04','SET-11'),('MD-02','DOC-01'),('MD-03','DOC-02'),('MD-05','DOC-03'),('MD-06','DOC-04'),('RT-03','DOC-05'),('RV-09','REV-01'),('ST-05','REV-02'),('FM-01','REV-03'),('IS-11','REV-04'),('RO-02','RVW-01'),('RO-06','RVW-02'),('FM-06','STO-01'),('FM-07','STO-02'),('RG-01','STO-03'),('SC-01','SCH-01'),('SC-02','SCH-02'),('PK-06','PKG-01');
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        UPDATE defects d SET check_id = r.new FROM check_renumber r WHERE d.check_id = r.old;
                        UPDATE check_opt_outs o SET check_id = r.new FROM check_renumber r WHERE o.check_id = r.old;
                        UPDATE settings s SET key = 'CHECK_OFF:' || r.new FROM check_renumber r WHERE s.key = 'CHECK_OFF:' || r.old;
                    END LOOP;
                    PERFORM set_config('app.tenant_id', '', true);
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The checks are numbered by the app (SET, DOC, REV, RVW, STO, SCH, PKG): what was found and what was switched
            // off keep their history under the new number. Row-level security is forced, so each organization in turn.
            migrationBuilder.Sql("""
                DO $$
                DECLARE t record;
                BEGIN
                    CREATE TEMP TABLE check_renumber(old text, new text) ON COMMIT DROP;
                    INSERT INTO check_renumber VALUES ('ID-05','SET-01'),('ST-04','SET-02'),('ST-06','SET-03'),('RO-01','SET-04'),('RO-03','SET-05'),('CL-06','SET-06'),('CL-07','SET-07'),('RT-01','SET-08'),('IS-06','SET-09'),('IS-09','SET-10'),('SC-04','SET-11'),('MD-02','DOC-01'),('MD-03','DOC-02'),('MD-05','DOC-03'),('MD-06','DOC-04'),('RT-03','DOC-05'),('RV-09','REV-01'),('ST-05','REV-02'),('FM-01','REV-03'),('IS-11','REV-04'),('RO-02','RVW-01'),('RO-06','RVW-02'),('FM-06','STO-01'),('FM-07','STO-02'),('RG-01','STO-03'),('SC-01','SCH-01'),('SC-02','SCH-02'),('PK-06','PKG-01');
                    FOR t IN SELECT id FROM tenants LOOP
                        PERFORM set_config('app.tenant_id', t.id::text, true);
                        UPDATE defects d SET check_id = r.old FROM check_renumber r WHERE d.check_id = r.new;
                        UPDATE check_opt_outs o SET check_id = r.old FROM check_renumber r WHERE o.check_id = r.new;
                        UPDATE settings s SET key = 'CHECK_OFF:' || r.old FROM check_renumber r WHERE s.key = 'CHECK_OFF:' || r.new;
                    END LOOP;
                    PERFORM set_config('app.tenant_id', '', true);
                END
                $$;
                """);
        }
    }
}
