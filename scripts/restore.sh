#!/bin/sh
# Wiederherstellung aus einem Backup. ACHTUNG: überschreibt die Zieldatenbank.
# Aufruf: scripts/restore.sh /backups/db_2026-09-23_0200.dump [/backups/files_2026-09-23_0200.tar.gz]
set -eu
DUMP=$1
FILES=${2:-}
echo "Stelle Datenbank aus $DUMP wieder her – Ziel: $DATABASE_URL"
printf "Fortfahren? Tippen Sie 'JA': "
read -r ok
[ "$ok" = "JA" ] || { echo "Abgebrochen."; exit 1; }
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$DUMP"
if [ -n "$FILES" ]; then
  tar -xzf "$FILES" -C /data
fi
echo "Wiederherstellung abgeschlossen."
