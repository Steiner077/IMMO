# IMMO – Plattform für die Immobilienverwaltung

IMMO ist eine modulare SaaS-Plattform für die professionelle Immobilienverwaltung. Sie besteht aus drei Teilen:

| Bereich | Für wen | Technik |
|---|---|---|
| **Verwaltungs-App** (`apps/web`) | Eigentümer, Verwaltung, Mitarbeiter, Hauswart, Dienstleister | React, Desktop-optimiert, responsiv |
| **Mieter-App** (`apps/tenant`) | Mieterinnen und Mieter (nur eigene Daten) | React-PWA, mobil optimiert, installierbar; später als iOS/Android-App verpackbar |
| **API & Automatisierung** (`apps/api`) | beide Apps, Schnittstellen | Node.js, Fastify, PostgreSQL, Prisma |

Excel ist **nicht** die Datenbank. Führende Datenquelle ist eine relationale PostgreSQL-Datenbank. Excel wird mit Vorschau importiert, exportiert und abgeglichen, und die Originaldatei wird nie überschrieben.

## Funktionsumfang

**Verwaltung**
- Dashboard mit Kennzahlen (Soll/Ist/Offen/Überfällig, Bestand, Mängel, Aufgaben, auslaufende Verträge) und Diagrammen (Einnahmen pro Monat, Soll gegen Ist, Einnahmen und Kosten pro Immobilie, offene Forderungen, Mängelentwicklung)
- Immobilien, Mietobjekte, Mieter, Mietverträge (inkl. Kündigung, Mietänderung ab Stichtag, anteilige Monate)
- **Zahlungsmodul**: vollständiger Datensatz je Zahlung (ID, Mieter, Vertrag, Immobilie, Wohnung, Datum, Betrag, Soll, Methode, Referenz, Originaltext, Quelle, Beleg, zugeordnete Monate, Status, Vertrauensscore), Umbuchung und Storno mit Begründungspflicht
- **Import-Zentrale** – ohne Bankanbindung, so wie Sie arbeiten:
  - **PDF-Kontoauszug** hochladen (digital oder **eingescannter Ausdruck**)
  - **Foto** eines Ausdrucks (Handy-Kamera direkt aus der App)
  - **Text einfügen**: Kontoauszug aus PDF/E-Banking kopieren und einfügen
  - zusätzlich camt.053/054 (XML), CSV und Excel
  - Texterkennung (OCR) für Scans/Fotos und **Saldo-Kontrolle**: jeder Betrag wird mit dem laufenden Kontosaldo gegengerechnet – bestätigt Betrag und Richtung und deckt Lesefehler auf
  - Analyse, Vorschau, Korrektur, Bestätigung und «Alle bestätigten Zahlungen verbuchen»
- **Monatsabschluss** mit Status je Mieter und Sprung in die vollständige Zahlungshistorie
- **Lernlogik**: Korrekturen (z. B. «M. Arnold» → Mario Arnold) werden für künftige Importe gelernt
- Mängelmanagement mit Tickets, Verlauf, Fotos, Hauswart- und Handwerkerzuweisung, Terminen und Kosten
- Nachrichtensystem (Verwaltung ↔ Mieter, Hauswart, Dienstleister), verknüpfbar mit Mieter, Immobilie, Wohnung, Mangel und Dokument
- Dokumentenablage mit automatischer Klassifizierung für Immobilie, Wohnung, Mieter, Vertrag, Zahlung und Mangel
- Finanzen: Ausgaben, Brutto/Netto, Ertrag pro Immobilie und Wohnung, Monats- und Jahresergebnis, Rendite
- Berichte: Excel-Jahresauswertung, Mieterspiegel
- Aufgaben, Termine (inkl. iCal-Export), Benachrichtigungszentrale, globale Suche (⌘K)
- Automatisierungs-Zentrale, Änderungsprotokoll (Audit-Log), Benutzer- und Rollenverwaltung

**Mieter-App**: Übersicht mit aktueller Monatsmiete und Status, Zahlungshistorie und offene Zahlungen, Mietvertrag, Dokumente (Download und Upload), Mängel melden mit Kamera/Fotos/Video, Terminwunsch und Verlauf, Nachrichten, Termine, Informationen zur Immobilie, wichtige Mitteilungen.

## Schnellstart (Entwicklung)

Voraussetzungen: Node.js ≥ 20, PostgreSQL ≥ 14. Für Scans/Fotos zusätzlich `tesseract-ocr`, `tesseract-ocr-deu` und `poppler-utils` (im Docker-Image enthalten).

```bash
npm install
cp apps/api/.env.example apps/api/.env      # DATABASE_URL und JWT_SECRET anpassen
npm run db:deploy                           # Migrationen anwenden
npm run db:seed                             # Demo-Daten (optional)
npm run sample:files                        # Beispiel-Kontoauszüge in ./samples erzeugen
npm run dev                                 # API :4000 · Verwaltung :5173 · Mieter-App :5174
```

### Demo-Zugänge (nach `db:seed`)

Passwort für alle Demo-Benutzer: `Immo2026!demo`

| Rolle | E-Mail | App |
|---|---|---|
| Eigentümer | `eigentuemer@immo.local` | Verwaltung |
| Verwalter | `verwaltung@immo.local` | Verwaltung |
| Mitarbeiter (nur Wohnpark Lindenhof) | `mitarbeiter@immo.local` | Verwaltung |
| Hauswart (keine Finanzdaten) | `hauswart@immo.local` | Verwaltung |
| Handwerker (nur zugewiesene Tickets) | `handwerker@immo.local` | Verwaltung |
| Mieter Peter Müller | `mieter@immo.local` | Mieter-App |
| Mieterin Monika Keller | `mieter2@immo.local` | Mieter-App |

**Demo-Ablauf Zahlungsimport:** Melden Sie sich als Verwaltung an. Öffnen Sie «Zahlungen importieren» und laden Sie `samples/kontoauszug-2026-09.pdf` hoch – oder den eingescannten Ausdruck `kontoauszug-2026-09-scan.pdf`, das Handyfoto `kontoauszug-2026-09-foto.jpg`, bzw. fügen Sie den Text unter «Text einfügen» ein. Klicken Sie auf «Alle sicheren bestätigen», prüfen und korrigieren Sie «M. Arnold», und wählen Sie dann «Alle bestätigten Zahlungen verbuchen». Danach zeigen Monatsabschluss, Mieterkonten und Dashboard den neuen Stand.

## Tests

```bash
npm test                     # Unit-Tests (Parser, Matching-Engine, Allokation, Geld, Rollen)
TEST_DATABASE_URL=postgresql://immo:immo@localhost:5432/immo_test npm run test:integration
npm run typecheck
```

Die Integrationstests prüfen unter anderem: Mieter sehen nur eigene Daten, der Hauswart sieht keine Finanzen, Filterparameter können den Immobilien-Scope nicht umgehen, und der PDF-Import funktioniert von Anfang bis Ende inklusive Lernlogik, Storno und Audit-Log.

## Produktion

Siehe [docs/BETRIEB.md](docs/BETRIEB.md). Kurzfassung:

```bash
cp .env.example .env   # Domains, Passwörter, JWT_SECRET setzen
docker compose --env-file .env up -d --build
```

Dabei laufen PostgreSQL, API, beide Apps, Caddy (automatisches HTTPS) und ein Backup-Dienst (täglich Datenbank und Dateien, Aufbewahrung konfigurierbar).

## Dokumentation

- [Architektur & Datenmodell](docs/ARCHITEKTUR.md)
- [Betrieb, Sicherheit & Backups](docs/BETRIEB.md)
- [Roadmap & Integrationen](docs/ROADMAP.md)

## Projektstruktur

```
apps/
  api/        Fastify-API, Prisma-Schema, Automatisierung, Import-Engine, Tests
  web/        Verwaltungs-App
  tenant/     Mieter-App (PWA)
packages/
  shared/     Rollen & Berechtigungen, Geld- und Periodenlogik, Bezeichnungen
  ui/         Gemeinsame UI-Komponenten (Design-System)
deploy/       Dockerfiles, nginx, Caddy (HTTPS)
scripts/      Backup & Restore
samples/      Beispiel-Kontoauszüge (PDF, camt.053, CSV)
```
