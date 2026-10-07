#!/bin/sh
# Proves the backups restore. Restores the latest backup and all archived WAL into
# a scratch directory, starts it on a private socket, and checks what came back:
# the tenants, the documents, and that every tenant's audit chain is intact.
# Records the result as a metric; RestoreDrillOverdue fires when none has passed
# for 35 days.
set -eu
pgbackrest-conf.sh
target=/tmp/restore-drill
rm -rf "$target" && mkdir -p "$target" && chown postgres:postgres "$target" && chmod 700 "$target"
started=$(date +%s)

echo "restore-drill: restoring"
gosu postgres pgbackrest --stanza=delios --pg1-path="$target" --archive-mode=off restore

echo "restore-drill: replaying the write-ahead log"
gosu postgres pg_ctl -D "$target" -w -t 3600 -l /tmp/restore-drill.log \
  -o "-c listen_addresses='' -c unix_socket_directories=/tmp -c archive_mode=off -c port=5499" start
until [ "$(gosu postgres psql -h /tmp -p 5499 -d postgres -tAc 'SELECT pg_is_in_recovery()')" = f ]; do sleep 2; done

q() { gosu postgres psql -h /tmp -p 5499 -d delios -tAc "$1"; }
tenants=$(q "SELECT count(*) FROM tenants")
documents=$(q "SELECT count(*) FROM documents")
broken=$(q "SELECT count(*) FROM tenants t WHERE audit_verify(t.id) IS NOT NULL")
gosu postgres pg_ctl -D "$target" -m fast stop >/dev/null
rm -rf "$target"
finished=$(date +%s)

echo "restore-drill: $tenants tenant(s), $documents document(s), $broken broken audit chain(s), $((finished - started))s"
if [ "$broken" != 0 ]; then
  echo "restore-drill: FAILED: the restored audit trail does not verify" >&2
  exit 1
fi

mkdir -p /var/lib/delios-metrics
cat > /var/lib/delios-metrics/restore-drill.prom.tmp <<METRICS
# HELP delios_restore_drill_last_success_timestamp_seconds When a restore drill last passed.
# TYPE delios_restore_drill_last_success_timestamp_seconds gauge
delios_restore_drill_last_success_timestamp_seconds $finished
# HELP delios_restore_drill_duration_seconds How long the last passing drill took: the recovery time to expect.
# TYPE delios_restore_drill_duration_seconds gauge
delios_restore_drill_duration_seconds $((finished - started))
# HELP delios_restore_drill_documents Documents found in the restored database.
# TYPE delios_restore_drill_documents gauge
delios_restore_drill_documents $documents
METRICS
mv /var/lib/delios-metrics/restore-drill.prom.tmp /var/lib/delios-metrics/restore-drill.prom
echo "restore-drill: PASSED"
