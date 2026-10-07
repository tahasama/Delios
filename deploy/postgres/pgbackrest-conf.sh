#!/bin/sh
# Writes /etc/pgbackrest/pgbackrest.conf from the environment.
#   BACKUP_REPO_TYPE     posix (a volume; development) or s3 (production)
#   BACKUP_REPO_PATH     where in the repository (default /var/lib/pgbackrest)
#   BACKUP_RETENTION_FULL  full backups kept (default 4: about four weeks)
#   BACKUP_CIPHER_PASS   encrypts the repository; required for s3
#   BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_REGION, BACKUP_S3_KEY, BACKUP_S3_SECRET
set -eu
mkdir -p /etc/pgbackrest
conf=/etc/pgbackrest/pgbackrest.conf
{
  echo "[global]"
  echo "repo1-type=${BACKUP_REPO_TYPE:-posix}"
  echo "repo1-path=${BACKUP_REPO_PATH:-/var/lib/pgbackrest}"
  echo "repo1-retention-full=${BACKUP_RETENTION_FULL:-4}"
  if [ -n "${BACKUP_CIPHER_PASS:-}" ]; then
    echo "repo1-cipher-type=aes-256-cbc"
    echo "repo1-cipher-pass=${BACKUP_CIPHER_PASS}"
  fi
  if [ "${BACKUP_REPO_TYPE:-posix}" = s3 ]; then
    echo "repo1-s3-endpoint=${BACKUP_S3_ENDPOINT}"
    echo "repo1-s3-bucket=${BACKUP_S3_BUCKET}"
    echo "repo1-s3-region=${BACKUP_S3_REGION:-us-east-1}"
    echo "repo1-s3-key=${BACKUP_S3_KEY}"
    echo "repo1-s3-key-secret=${BACKUP_S3_SECRET}"
    echo "repo1-s3-uri-style=path"
  fi
  echo "start-fast=y"
  echo "process-max=2"
  echo "compress-type=zst"
  echo "log-level-console=info"
  echo "log-level-file=off"
  echo
  echo "[delios]"
  echo "pg1-path=${PGDATA:-/var/lib/postgresql/data}"
} > "$conf"
chown postgres:postgres "$conf"
chmod 600 "$conf"
if [ "${BACKUP_REPO_TYPE:-posix}" = posix ]; then
  # A standby or a drill may mount the repository read-only.
  mkdir -p "${BACKUP_REPO_PATH:-/var/lib/pgbackrest}" 2>/dev/null || true
  chown postgres:postgres "${BACKUP_REPO_PATH:-/var/lib/pgbackrest}" 2>/dev/null || true
fi
