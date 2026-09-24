export interface ParsedTransaction {
  bookingDate: Date;
  valueDate?: Date | null;
  amountCents: number;
  isCredit: boolean;
  payerName: string | null;
  payerIban: string | null;
  reference: string | null;
  rawText: string;
  /** Laufender Kontosaldo nach der Buchung (falls im Auszug vorhanden) */
  balanceCents?: number | null;
  /** Betrag und Richtung durch Saldo-Differenz bestätigt */
  verified?: boolean;
}

export interface TextItem {
  str: string;
  x: number;
  width: number;
}

export interface TextLine {
  page: number;
  y: number;
  text: string;
  items: TextItem[];
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  meta: {
    format: string;
    currency?: string;
    iban?: string | null;
    /** Kontoinhaber laut Auszug (eigene Überweisungen werden ignoriert) */
    accountHolder?: string | null;
    periodFrom?: string | null;
    periodTo?: string | null;
    warnings: string[];
    lineCount?: number;
    /** Text wurde per Texterkennung (OCR) gewonnen */
    ocr?: boolean;
    /** Buchungen wurden von der KI ausgelesen */
    ai?: boolean;
    /** Saldo-Kontrolle: bestätigte / geprüfte Buchungen */
    balanceCheck?: { verified: number; checked: number; corrected: number } | null;
  };
}
