#!/bin/sh
# Tägliche Sicherung: Datenbank (pg_dump, komprimiert) + Dateiablage.
# Aufbewahrung: BACKUP_RETENTION_DAYS (Standard 30). Läuft im Backup-Container.
set -eu
STAMP=$(date +%Y-%m-%d_%H%M)
DEST=${BACKUP_DIR:-/backups}
mkdir -p "$DEST"
echo "[$(date)] Starte Backup $STAMP"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$DEST/db_$STAMP.dump"
if [ -d /data/storage ]; then
  tar -czf "$DEST/files_$STAMP.tar.gz" -C /data storage
fi
# Integrität prüfen
pg_restore --list "$DEST/db_$STAMP.dump" > /dev/null
find "$DEST" -type f -mtime +"${BACKUP_RETENTION_DAYS:-30}" -delete
echo "[$(date)] Backup abgeschlossen: $(ls -1 "$DEST" | wc -l) Dateien vorhanden"
