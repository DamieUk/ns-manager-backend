#!/usr/bin/env bash
# Backs up the MongoDB database and all uploaded files into $BACKUP_DIR/<timestamp>/,
# keeping the last $KEEP_DAYS days. Run nightly from cron on the server, e.g.:
#   15 3 * * * /opt/numenor/ns-manager-backend/deploy/backup.sh >> /var/log/numenor-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/numenor}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DEST="$BACKUP_DIR/$(date +%F_%H%M)"
mkdir -p "$DEST"

docker compose exec -T mongo sh -c \
  'mongodump -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db numenor --archive --gzip' \
  > "$DEST/mongo.archive.gz"

docker compose exec -T api tar -C /app/uploads -czf - . > "$DEST/uploads.tar.gz"

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +

echo "[backup] $(date -Is) -> $DEST ($(du -sh "$DEST" | cut -f1))"
