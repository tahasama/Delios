#!/bin/sh
# Copies every stored file to a second location, so the database's backups have
# the files they refer to. Copy, never sync: nothing deleted or changed at the
# source is deleted or changed in the copy (--immutable refuses to overwrite).
# Source and target are rclone remotes configured by environment variables:
#   RCLONE_CONFIG_SOURCE_*   the primary bucket (S3-compatible)
#   RCLONE_CONFIG_TARGET_*   the second location (another provider or region; a volume in development)
#   SOURCE_PATH, TARGET_PATH bucket and path on each, FILE_BACKUP_EVERY seconds (default 604800, a week)
# Each file is copied as it is stored: the app says its key on a Valkey list (Documents/FileBackup.cs, files:to-copy)
# and the copier waits on it (owner: no timer to find out what is new). The app holds no key to the copy: only this
# copier reads the store (with a key that may only read) and writes the copy. The full comparison is the safety net
# that copies what a stop lost. What is copied is sealed by the app (Documents/FileCipher.cs): the copy reads as nothing.
#   VALKEY_HOST, VALKEY_PORT  where the list is (valkey:6379)
set -u
METRICS=/var/lib/delios-metrics
EVERY=${FILE_BACKUP_EVERY:-604800}
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

# Each file as it is stored: wait on the list, copy that one file (never over one already there), and put it back on
# the list when the copy fails, to try again a little later.
copy_as_stored() {
  while true; do
    key=$(valkey-cli -h "${VALKEY_HOST:-valkey}" -p "${VALKEY_PORT:-6379}" --raw BRPOP files:to-copy 0 2>/dev/null | sed -n 2p)
    if [ -z "$key" ]; then sleep 5; continue; fi
    if ! rclone copyto "source:${SOURCE_PATH}/$key" "target:${TARGET_PATH}/$key" --immutable --checksum --log-level NOTICE; then
      valkey-cli -h "${VALKEY_HOST:-valkey}" -p "${VALKEY_PORT:-6379}" LPUSH files:to-copy "$key" >/dev/null 2>&1
      echo "file-backup: copying $key failed; trying again shortly" >&2
      sleep "$RETRY"
    fi
  done
}
copy_as_stored &

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
