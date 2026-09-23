/** Deutsche Bezeichnungen und Enum-Werte, die Frontend und Backend teilen. */

export const PROPERTY_TYPES = { RESIDENTIAL: 'Wohnliegenschaft', COMMERCIAL: 'Geschäftsliegenschaft', MIXED: 'Gemischte Nutzung', OTHER: 'Andere' } as const;

export const UNIT_TYPES = {
  APARTMENT: 'Wohnung',
  HOUSE: 'Haus',
  COMMERCIAL: 'Gewerbe',
  OFFICE: 'Büro',
  PARKING: 'Parkplatz',
  GARAGE: 'Garage',
  STORAGE: 'Lager / Keller',
  OTHER: 'Andere',
} as const;

export const LEASE_STATUS = {
  DRAFT: 'Entwurf',
  ACTIVE: 'Aktiv',
  TERMINATED: 'Gekündigt',
  ENDED: 'Beendet',
} as const;

/** Status einer monatlichen Sollstellung (Mietforderung). */
export const CHARGE_STATUS = {
  OPEN: 'Offen',
  PARTIAL: 'Teilbezahlt',
  PAID: 'Bezahlt',
  OVERPAID: 'Überbezahlt',
  OVERDUE: 'Überfällig',
  CANCELLED: 'Storniert',
} as const;

/** Status einer eingegangenen Zahlung. */
export const PAYMENT_STATUS = {
  ASSIGNED: 'Bezahlt / zugeordnet',
  PARTIAL: 'Teilweise zugeordnet',
  OVERPAID: 'Überbezahlt',
  UNCLEAR: 'Unklar',
  REVIEW: 'Zuordnung prüfen',
  REVERSED: 'Storniert',
} as const;

export const PAYMENT_METHODS = {
  BANK_TRANSFER: 'Banküberweisung',
  QR_BILL: 'QR-Rechnung',
  STANDING_ORDER: 'Dauerauftrag',
  DIRECT_DEBIT: 'Lastschrift',
  CASH: 'Bar',
  OTHER: 'Andere',
} as const;

export const PAYMENT_SOURCES = {
  MANUAL: 'Manuell',
  PDF_IMPORT: 'PDF-Import',
  CSV_IMPORT: 'CSV-Import',
  EXCEL_IMPORT: 'Excel-Import',
  CAMT_IMPORT: 'Bank-XML (camt)',
  SCAN_IMPORT: 'Scan / Foto (OCR)',
  TEXT_IMPORT: 'Eingefügter Text',
  BANK_API: 'Bankschnittstelle',
} as const;

export const IMPORT_ROW_STATUS = {
  READY: 'Bereit zur Bestätigung',
  NEEDS_REVIEW: 'Zuordnung prüfen',
  UNMATCHED: 'Unklar',
  DUPLICATE: 'Duplikat',
  IGNORED: 'Ignoriert',
  POSTED: 'Verbucht',
} as const;

export const DAMAGE_CATEGORIES = {
  HEATING: 'Heizung',
  WATER: 'Wasser / Sanitär',
  ELECTRICITY: 'Elektrik',
  WINDOWS_DOORS: 'Fenster / Türen',
  APPLIANCES: 'Haushaltsgeräte',
  BATHROOM: 'Bad / WC',
  KITCHEN: 'Küche',
  EXTERIOR: 'Aussenbereich / Gebäudehülle',
  COMMON_AREAS: 'Allgemeine Räume',
  PESTS: 'Schädlinge',
  OTHER: 'Anderes',
} as const;

export const PRIORITIES = { LOW: 'Niedrig', MEDIUM: 'Mittel', HIGH: 'Hoch', URGENT: 'Dringend' } as const;

export const DAMAGE_STATUS = {
  NEW: 'Neu',
  ACKNOWLEDGED: 'Bestätigt',
  IN_PROGRESS: 'In Bearbeitung',
  WAITING: 'Wartet',
  RESOLVED: 'Erledigt',
  CLOSED: 'Abgeschlossen',
  REJECTED: 'Abgelehnt',
} as const;

export const TASK_STATUS = { OPEN: 'Offen', IN_PROGRESS: 'In Arbeit', DONE: 'Erledigt', CANCELLED: 'Abgebrochen' } as const;

export const DOCUMENT_CATEGORIES = {
  CONTRACT: 'Vertrag',
  INSURANCE: 'Versicherung',
  INVOICE: 'Rechnung',
  CONSTRUCTION: 'Bauunterlagen',
  HANDOVER: 'Übergabeprotokoll',
  PHOTO: 'Foto',
  VIDEO: 'Video',
  LEASE: 'Mietvertrag',
  TERMINATION: 'Kündigung',
  CORRESPONDENCE: 'Korrespondenz',
  BANK_STATEMENT: 'Kontoauszug',
  RECEIPT: 'Zahlungsbeleg',
  EXPORT: 'Export',
  OTHER: 'Andere',
} as const;

/** Dokumentkategorien, die Finanzinformationen enthalten (für Hauswart gesperrt). */
export const FINANCIAL_DOCUMENT_CATEGORIES = ['INVOICE', 'BANK_STATEMENT', 'RECEIPT', 'EXPORT', 'LEASE', 'INSURANCE'] as const;

export const EXPENSE_CATEGORIES = {
  REPAIR: 'Reparaturen',
  INSURANCE: 'Versicherungen',
  MORTGAGE: 'Hypotheken',
  CARETAKER: 'Hauswart',
  ELECTRICITY: 'Strom',
  WATER: 'Wasser',
  HEATING: 'Heizung / Energie',
  CLEANING: 'Reinigung',
  MANAGEMENT: 'Verwaltung',
  CRAFTSMEN: 'Handwerker',
  TAXES: 'Steuern / Abgaben',
  OTHER: 'Andere',
} as const;

export const NOTIFICATION_TYPES = {
  DAMAGE_NEW: 'Neue Mängelmeldung',
  DAMAGE_UPDATE: 'Mangel aktualisiert',
  RENT_OPEN: 'Miete offen',
  RENT_OVERDUE: 'Miete überfällig',
  LEASE_EXPIRING: 'Vertrag läuft aus',
  MESSAGE_NEW: 'Neue Nachricht',
  DOCUMENT_UPLOADED: 'Dokument hochgeladen',
  APPOINTMENT_REMINDER: 'Terminerinnerung',
  PAYMENT_UNCLEAR: 'Zahlung unklar',
  PAYMENT_POSTED: 'Zahlungen verbucht',
  IMPORT_READY: 'Import analysiert',
  TASK_ASSIGNED: 'Aufgabe zugewiesen',
  ANNOUNCEMENT: 'Mitteilung',
  SYSTEM: 'System',
} as const;

export type LabelMap = Record<string, string>;

export function label(map: LabelMap, key: string | null | undefined): string {
  if (!key) return '–';
  return map[key] ?? key;
}
