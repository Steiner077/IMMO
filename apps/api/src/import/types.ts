export interface ParsedTransaction {
  bookingDate: Date;
  valueDate?: Date | null;
  amountCents: number;
  isCredit: boolean;
  payerName: string | null;
  payerIban: string | null;
  reference: string | null;
  rawText: string;
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
    periodFrom?: string | null;
    periodTo?: string | null;
    warnings: string[];
    lineCount?: number;
  };
}
