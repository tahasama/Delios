#!/bin/sh
# Copies every stored file to a second location, so the database's backups have
# the files they refer to. Copy, never sync: nothing deleted or changed at the
# source is deleted or changed in the copy (--immutable refuses to overwrite).
# Source and target are rclone remotes configured by environment variables:
#   RCLONE_CONFIG_SOURCE_*   the primary bucket (S3-compatible)
#   RCLONE_CONFIG_TARGET_*   the second location (another provider or region; a volume in development)
#   SOURCE_PATH, TARGET_PATH bucket and path on each, FILE_BACKUP_EVERY seconds (default 21600)
set -u
METRICS=/var/lib/delios-metrics
EVERY=${FILE_BACKUP_EVERY:-21600}
# After a failure, try again soon rather than a whole interval later.
RETRY=${FILE_BACKUP_RETRY:-300}
last_success=0; failures=0; files=0

write_metrics() {
  cat > "$METRICS/file-backup.prom.tmp" <<M
# HELP delios_file_backup_last_success_timestamp_seconds When the file copy last completed.
# TYPE delios_file_backup_last_success_timestamp_seconds gauge
delios_file_backup_last_success_timestamp_seconds $last_success
# HELP delios_file_backup_failures_total File copies that failed since the copier started.
# TYPE delios_file_backup_failures_total counter
delios_file_backup_failures_total $failures
# HELP delios_file_backup_objects Objects in the copy after the last run.
# TYPE delios_file_backup_objects gauge
delios_file_backup_objects $files
M
  mv "$METRICS/file-backup.prom.tmp" "$METRICS/file-backup.prom"
}

while true; do
  if rclone copy "source:${SOURCE_PATH}" "target:${TARGET_PATH}" --immutable --checksum --transfers 8 --log-level NOTICE; then
    last_success=$(date +%s)
    files=$(rclone size "target:${TARGET_PATH}" --json 2>/dev/null | sed -n 's/.*"count":\([0-9]*\).*/\1/p')
    files=${files:-0}
    echo "file-backup: copy complete, $files object(s) in the copy"
    wait=$EVERY
  else
    failures=$((failures + 1))
    echo "file-backup: copy failed; retrying in ${RETRY}s" >&2
    wait=$RETRY
  fi
  write_metrics
  sleep "$wait"
done
