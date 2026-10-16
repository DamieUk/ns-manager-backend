#!/usr/bin/env bash
# Backs up the MySQL database and all uploaded files into $BACKUP_DIR/<timestamp>/, keeping the
# last $KEEP_DAYS days. Uploads are snapshotted with rsync --link-dest: files unchanged since the
# previous backup become hard links, so each day only costs the space of new files.
# Run nightly from cron on the server, e.g.:
#   15 3 * * * /opt/numenor/ns-manager-backend/deploy/backup.sh >> /var/log/numenor-backup.log 2>&1
set -euo pipefail
umask 077 # dumps hold password hashes and encrypted fields: root-only

cd "$(dirname "$0")"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/numenor}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
PREVIOUS="$(find "$BACKUP_DIR" -mindepth 2 -maxdepth 2 -type d -name uploads | sort | tail -n 1)"
DEST="$BACKUP_DIR/$(date +%F_%H%M%S)"
mkdir -p "$DEST"

docker compose exec -T db sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --single-transaction --no-tablespaces -uroot numenor' \
  | gzip > "$DEST/db.sql.gz"

UPLOADS="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/uploads"}}{{.Source}}{{end}}{{end}}' "$(docker compose ps -q api)")"
LINK=()
if [ -n "$PREVIOUS" ]; then LINK=(--link-dest="$PREVIOUS"); fi
rsync -a --delete ${LINK[@]+"${LINK[@]}"} "$UPLOADS/" "$DEST/uploads/"

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +

echo "[backup] $(date '+%Y-%m-%dT%H:%M:%S%z') -> $DEST (all backups: $(du -sh "$BACKUP_DIR" | cut -f1))"
