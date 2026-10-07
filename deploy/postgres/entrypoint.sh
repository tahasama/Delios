#!/bin/sh
# DELIOS_PG_ROLE=primary (default): archives the write-ahead log with pgBackRest
#   at least every 60 seconds, so a restore loses at most about a minute, and
#   keeps backups current (backup-loop.sh).
# DELIOS_PG_ROLE=standby: on first start copies the primary with pg_basebackup,
#   then follows it, read-only, until promoted.
set -eu
PGDATA=${PGDATA:-/var/lib/postgresql/data}
mkdir -p /var/lib/delios-metrics && chown postgres:postgres /var/lib/delios-metrics
pgbackrest-conf.sh

case "${DELIOS_PG_ROLE:-primary}" in
  primary)
    gosu postgres backup-loop.sh &
    exec docker-entrypoint.sh "$@" \
      -c archive_mode=on \
      -c "archive_command=pgbackrest --stanza=delios archive-push %p" \
      -c archive_timeout=60 \
      -c wal_keep_size=1GB
    ;;
  standby)
    if [ ! -s "$PGDATA/PG_VERSION" ]; then
      echo "standby: copying ${PRIMARY_HOST:-postgres}"
      mkdir -p "$PGDATA" && chown postgres:postgres "$PGDATA" && chmod 700 "$PGDATA"
      until PGPASSWORD="$REPLICATION_PASSWORD" gosu postgres pg_basebackup \
          -h "${PRIMARY_HOST:-postgres}" -U replicator -D "$PGDATA" -X stream -R; do
        echo "standby: primary not reachable yet; retrying in 10 s" >&2
        rm -rf "${PGDATA:?}"/*
        sleep 10
      done
    fi
    # Falls back to the backup repository when streaming has fallen too far behind.
    exec docker-entrypoint.sh "$@" \
      -c hot_standby=on \
      -c "restore_command=pgbackrest --stanza=delios archive-get %f \"%p\""
    ;;
  *)
    echo "DELIOS_PG_ROLE must be primary or standby" >&2
    exit 2
    ;;
esac
