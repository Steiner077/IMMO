# Roadmap & Integrationen

Zahlungen werden bewusst **ohne direkte Bankanbindung** erfasst: PDF-Kontoauszug, eingescannter Ausdruck, Foto oder eingefügter Text (mit Texterkennung und Saldo-Kontrolle). Eine Bankanbindung (EBICS/bLink) ist nicht vorgesehen, könnte aber später über die Quelle `BANK_API` ergänzt werden.

Die Architektur ist auf diese Erweiterungen vorbereitet (Schnittstellen und Datenmodell sind vorhanden):

| Thema | Ansatz | Anknüpfungspunkt |
|---|---|---|
| **QR-Rechnungen** | QR-Einzahlungsschein pro Mietvertrag erzeugen (QR-IBAN + Referenz) | `Lease.paymentReference`; die Matching-Engine erkennt die Referenz bereits zu 100 % |
| **Buchhaltung** | Export/Sync nach Bexio, Abacus, Banana (Buchungsjournal) | `Payment`, `Expense`, `AuditLog` |
| **E-Mail / SMS / Push / WhatsApp** | Dispatcher je Kanal (z. B. Postmark, Twilio, FCM/APNs, WhatsApp Business API) | `registerDispatcher()` in `services/notifications.ts`, `Message.channel` |
| **Cloud-Speicher** | S3-kompatibel (z. B. Exoscale, Infomaniak) | `StorageDriver` in `lib/storage.ts` |
| **Kalender** | CalDAV/Google/Microsoft 365 | iCal-Export `/appointments/calendar.ics` vorhanden |
| **Digitale Signaturen** | Skribble oder DocuSign für Mietverträge und Übergabeprotokolle | `Document` + `Lease` |
| **Native Apps** | Mieter-App mit Capacitor als iOS/Android-App verpacken (Kamera, Push) | `apps/tenant` ist eine PWA mit Manifest und Service Worker |
| **Nebenkostenabrechnung** | Verteilschlüssel, Akonto-Abgleich, Abrechnungs-PDF | `Lease.utilitiesCents`, `Expense.category` |
| **Mahnwesen** | Stufen, Mahngebühren, Mahnbriefe als PDF | Job `overdue-check` |
| **2-Faktor-Anmeldung** | TOTP oder Passkeys für Verwaltungsrollen | `auth`-Modul |
