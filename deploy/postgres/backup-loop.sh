#!/bin/sh
# Keeps backups current, as the postgres user, beside the server:
#   a full backup when the last full is older than BACKUP_FULL_EVERY (default 7 days),
#   otherwise an incremental when the last backup is older than BACKUP_EVERY (default 24 h).
# The write-ahead log is archived continuously by archive_command, so any moment
# between backups can be restored. Results go to node-exporter as metrics; the
# BackupTooOld and BackupFailing alerts read them.
set -u
METRICS_DIR=/var/lib/delios-metrics
STATE="$METRICS_DIR/backup.state"
FULL_EVERY=${BACKUP_FULL_EVERY:-604800}
EVERY=${BACKUP_EVERY:-86400}
CHECK_EVERY=600

last_full=0; last_backup=0; failures=0; duration=0; archive_ok=0
[ -f "$STATE" ] && . "$STATE"

write_metrics() {
  cat > "$METRICS_DIR/backup.prom.tmp" <<METRICS
# HELP delios_backup_last_success_timestamp_seconds When the last backup of each type finished.
# TYPE delios_backup_last_success_timestamp_seconds gauge
delios_backup_last_success_timestamp_seconds{type="full"} $last_full
delios_backup_last_success_timestamp_seconds{type="any"} $last_backup
# HELP delios_backup_failures_total Backups that failed since the server started.
# TYPE delios_backup_failures_total counter
delios_backup_failures_total $failures
# HELP delios_backup_last_duration_seconds How long the last backup took.
# TYPE delios_backup_last_duration_seconds gauge
delios_backup_last_duration_seconds $duration
# HELP delios_backup_archive_check_ok Whether the last check of WAL archiving passed.
# TYPE delios_backup_archive_check_ok gauge
delios_backup_archive_check_ok $archive_ok
METRICS
  mv "$METRICS_DIR/backup.prom.tmp" "$METRICS_DIR/backup.prom"
  printf 'last_full=%s\nlast_backup=%s\n' "$last_full" "$last_backup" > "$STATE"
}

# TCP, not the socket: the server initdb runs briefly on first start listens on no port.
until pg_isready -q -h 127.0.0.1; do sleep 5; done
until pgbackrest --stanza=delios stanza-create; do
  echo "backup-loop: stanza-create failed; retrying in 60 s" >&2
  sleep 60
done
write_metrics

# What the repository itself holds is the truth: a repository lost or replaced
# (a new volume, a rebuilt server) must get a full backup now, not when a
# remembered date says one is due, and the alerts must see that it has none.
from_repository() {
  info=$(pgbackrest --stanza=delios info --output=json 2>/dev/null) || return 0
  set -- $(printf '%s' "$info" | tr ',{}[]' '\n\n\n\n\n' | awk -F: '
    /^"stop":[0-9]+$/ { stop = $2 }
    /^"type":"(full|diff|incr)"$/ { if ($2 == "\"full\"" && stop > full) full = stop; if (stop > any) any = stop }
    END { print full + 0, any + 0 }')
  last_full=$1; last_backup=$2
}

while true; do
  if pgbackrest --stanza=delios check >/dev/null 2>&1; then archive_ok=1; else archive_ok=0; fi
  from_repository

  now=$(date +%s)
  type=""
  if [ $((now - last_full)) -ge "$FULL_EVERY" ]; then type=full
  elif [ $((now - last_backup)) -ge "$EVERY" ]; then type=incr
  fi

  if [ -n "$type" ]; then
    started=$(date +%s)
    if pgbackrest --stanza=delios --type="$type" backup; then
      finished=$(date +%s)
      duration=$((finished - started))
      last_backup=$finished
      [ "$type" = full ] && last_full=$finished
      echo "backup-loop: $type backup finished in ${duration}s"
    else
      failures=$((failures + 1))
      echo "backup-loop: $type backup failed" >&2
    fi
  fi
  write_metrics
  sleep "$CHECK_EVERY"
done
