# Betrieb

## Installation (Docker)

1. Server mit Docker und Docker Compose sowie zwei DNS-Einträgen (z. B. `verwaltung.example.ch`, `mieter.example.ch`), die auf den Server zeigen.
2. `cp .env.example .env` und Werte setzen:
   - `POSTGRES_PASSWORD`: langes Zufallspasswort
   - `JWT_SECRET`: `openssl rand -base64 48`
   - `ADMIN_DOMAIN`, `TENANT_DOMAIN`, `ACME_EMAIL`
3. `docker compose --env-file .env up -d --build`
4. Ersten Eigentümer anlegen (einmalig):
   ```bash
   docker compose exec api node dist/cli.js create-owner --org "Meine Verwaltung" --email ich@example.ch --first Vorname --last Nachname
   ```
   Das Startpasswort wird einmalig ausgegeben und muss beim ersten Login geändert werden.

Datenbankmigrationen werden beim Start der API automatisch angewendet (`prisma migrate deploy`). Das ist nicht destruktiv.

## Backups

- Der Dienst `backup` erstellt **täglich um 02:00 UTC** einen komprimierten `pg_dump` sowie ein Archiv der Dateiablage in `BACKUP_PATH` und prüft die Lesbarkeit des Dumps.
- Aufbewahrung: `BACKUP_RETENTION_DAYS` (Standard 30).
- **Empfehlung:** `BACKUP_PATH` zusätzlich verschlüsselt ausser Haus spiegeln (z. B. `restic` oder `rclone` auf Swiss-Cloud-Speicher).
- Manuelles Backup: `docker compose exec backup /scripts/backup.sh`
- Wiederherstellung: `docker compose exec backup /scripts/restore.sh /backups/db_<stamp>.dump /backups/files_<stamp>.tar.gz`

## Überwachung

- Healthcheck: `GET /api/health` (auch im Docker-HEALTHCHECK).
- Logs: `docker compose logs -f api`. Die Logs sind strukturiert (JSON) mit Request-ID, und Fehler 500 geben die Request-ID an den Client zurück.
- Automatisierungen: Protokoll unter «Automatisierung» in der Verwaltungs-App.

## Updates

```bash
git pull
docker compose --env-file .env up -d --build
```

## Konfiguration der API

| Variable | Bedeutung | Standard |
|---|---|---|
| `DATABASE_URL` | PostgreSQL-Verbindung | – |
| `JWT_SECRET` | Signaturschlüssel (≥ 32 Zeichen) | – |
| `ACCESS_TOKEN_TTL` | Gültigkeit Access-Token | `15m` |
| `REFRESH_TOKEN_TTL_DAYS` | Sitzungsdauer | `30` |
| `CORS_ORIGINS` | erlaubte Frontends | lokal |
| `STORAGE_DIR` | Dateiablage | `./storage` |
| `MAX_UPLOAD_MB` | maximale Dateigrösse | `25` |
| `AUTOMATION_ENABLED` | Hintergrund-Jobs aktiv | `true` |
| `LOGIN_RATE_LIMIT` | Anmeldeversuche pro IP und Minute | `10` |
| `LOG_LEVEL` | Protokollstufe | `info` |

Fachliche Einstellungen (Schwellenwerte der Zahlungsautomatik, Karenzfrist, Vorlaufzeiten, Excel-Ablage, Mieter-Hinweise) werden in der App unter **Einstellungen → Organisation & Automatik** gepflegt und protokolliert.

## Sicherung auf dem eigenen PC (ohne Docker)

```
npm run sichern                        # Ordner backups/ im Projekt
npm run sichern -- "D:\Sicherung"      # z. B. USB-Stick oder OneDrive-Ordner
npm run wiederherstellen -- <Datei.dump> --ja
```

Gesichert werden die Datenbank (aus `apps/api/.env`) und die Dokumentenablage. Die letzten 30 Sicherungen bleiben erhalten.
`pg_dump` wird im PATH oder unter `C:\Program Files\PostgreSQL\<Version>\bin` gesucht.
