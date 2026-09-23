import type Anthropic from '@anthropic-ai/sdk';
import { normalizeText } from '@immo/shared';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { badRequest } from '../lib/errors.js';
import { AI_BETAS, ai, aiError, textOf } from './ai.js';

/** Was die KI aus einem Mietvertrag auslesen soll (Beträge in CHF, Daten als YYYY-MM-DD). */
export interface ContractData {
  tenant: {
    isCompany: boolean;
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    email: string | null;
    phone: string | null;
    street: string | null;
    zip: string | null;
    city: string | null;
    dateOfBirth: string | null;
    additionalTenants: string | null;
  };
  property: { street: string | null; zip: string | null; city: string | null };
  unit: { label: string | null; type: string | null; floor: string | null; rooms: number | null; areaM2: number | null };
  lease: {
    startDate: string | null;
    endDate: string | null;
    noticePeriodMonths: number | null;
    netRentChf: number | null;
    utilitiesChf: number | null;
    depositChf: number | null;
    dueDay: number | null;
    paymentReference: string | null;
  };
  landlord: string | null;
  notes: string | null;
  warnings: string[];
  confidence: number;
}

const str = { type: ['string', 'null'] };
const num = { type: ['number', 'null'] };
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

const SCHEMA = obj({
  tenant: obj({
    isCompany: { type: 'boolean' },
    firstName: str,
    lastName: str,
    companyName: str,
    email: str,
    phone: str,
    street: { ...str, description: 'Bisherige Adresse des Mieters (falls angegeben)' },
    zip: str,
    city: str,
    dateOfBirth: { ...str, description: 'YYYY-MM-DD' },
    additionalTenants: { ...str, description: 'Weitere Mieter / Solidarhafter, kommagetrennt' },
  }),
  property: obj({ street: { ...str, description: 'Strasse und Hausnummer des Mietobjekts' }, zip: str, city: str }),
  unit: obj({
    label: { ...str, description: 'Wohnungsbezeichnung/-nummer, z. B. "3A" oder "2. OG links"' },
    type: { type: ['string', 'null'], enum: ['APARTMENT', 'HOUSE', 'COMMERCIAL', 'OFFICE', 'PARKING', 'GARAGE', 'STORAGE', 'OTHER', null] },
    floor: str,
    rooms: num,
    areaM2: num,
  }),
  lease: obj({
    startDate: { ...str, description: 'Mietbeginn YYYY-MM-DD' },
    endDate: { ...str, description: 'Nur bei befristeten Verträgen, YYYY-MM-DD' },
    noticePeriodMonths: num,
    netRentChf: { ...num, description: 'Nettomiete pro Monat in CHF' },
    utilitiesChf: { ...num, description: 'Nebenkosten (Akonto/Pauschale) pro Monat in CHF, Summe aller Positionen' },
    depositChf: { ...num, description: 'Mietkaution / Sicherheitsleistung in CHF' },
    dueDay: { ...num, description: 'Fälligkeitstag im Monat, z. B. 1' },
    paymentReference: str,
  }),
  landlord: str,
  notes: { ...str, description: 'Kurze Zusammenfassung wichtiger Klauseln (Indexierung, Haustiere, Parkplatz, Sonderabmachungen) – max. 6 Zeilen' },
  warnings: { type: 'array', items: { type: 'string' }, description: 'Unsichere oder fehlende Angaben, die geprüft werden müssen' },
  confidence: { type: 'integer', description: 'Gesamtsicherheit 0–100' },
});

const PROMPT = `Du liest einen Schweizer Mietvertrag (Wohn- oder Geschäftsraum) und überträgst die Angaben in das vorgegebene Schema.

Regeln:
- Übernimm nur, was im Dokument steht. Fehlt eine Angabe, setze null und nenne sie unter "warnings". Nichts erfinden oder schätzen.
- Beträge als Zahl in CHF pro Monat (z. B. 1850 oder 1850.5), ohne Tausendertrennzeichen. Werden Nebenkosten in mehreren Positionen aufgeführt (Heizung, Warmwasser, Betriebskosten), addiere sie zu utilitiesChf und erwähne die Aufteilung in "notes".
- Daten im Format YYYY-MM-DD. Kündigungsfrist in Monaten.
- Der Mieter ist die Vertragspartei, nicht der Vermieter/die Verwaltung. Mehrere Mieter: den ersten als Hauptmieter, weitere unter additionalTenants.
- Ist etwas schlecht lesbar oder mehrdeutig, übernimm die wahrscheinlichste Lesart und beschreibe die Unsicherheit in "warnings".`;

export async function extractContract(file: { buffer: Buffer; mimetype: string }): Promise<ContractData> {
  let source: Anthropic.Beta.BetaContentBlockParam;
  if (file.mimetype === 'application/pdf') {
    source = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.buffer.toString('base64') } };
  } else if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
    source = { type: 'image', source: { type: 'base64', media_type: file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp', data: file.buffer.toString('base64') } };
  } else {
    throw badRequest('Bitte den Mietvertrag als PDF oder Foto (JPG/PNG) hochladen.');
  }
  try {
    const response = await ai().beta.messages.create({
      model: config.AI_MODEL,
      max_tokens: 16000,
      betas: AI_BETAS,
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [source, { type: 'text', text: PROMPT }] }],
    });
    if (response.stop_reason === 'refusal') throw badRequest('Die KI konnte dieses Dokument nicht verarbeiten.');
    if (response.stop_reason === 'max_tokens') throw badRequest('Das Dokument ist zu umfangreich für die automatische Erkennung.');
    return JSON.parse(textOf(response)) as ContractData;
  } catch (e) {
    aiError(e);
  }
}

/** Findet passende bestehende Datensätze (Immobilie, Wohnung, Mieter) zu den ausgelesenen Angaben. */
export async function matchContract(organizationId: string, data: ContractData) {
  const n = (s: string | null | undefined) => normalizeText(s).replace(/strasse/g, 'str').replace(/\s+/g, '');
  const properties = await prisma.property.findMany({
    where: { organizationId, archivedAt: null },
    include: { units: { where: { archivedAt: null }, include: { leases: { where: { status: { in: ['ACTIVE', 'TERMINATED'] } }, select: { id: true } } } } },
  });
  const street = n(data.property.street);
  const property =
    properties.find((p) => street && n(p.street) === street) ??
    properties.find((p) => street && (n(p.street).includes(street) || street.includes(n(p.street)) || n(p.name) === street)) ??
    null;
  const label = n(data.unit.label);
  const unit = property && label ? property.units.find((u) => n(u.label) === label || label.includes(n(u.label)) && n(u.label).length >= 2) ?? null : null;

  const t = data.tenant;
  const tenant = await prisma.tenant.findFirst({
    where: {
      organizationId,
      OR: [
        ...(t.email ? [{ email: { equals: t.email, mode: 'insensitive' as const } }] : []),
        ...(t.lastName && t.firstName ? [{ lastName: { equals: t.lastName, mode: 'insensitive' as const }, firstName: { equals: t.firstName, mode: 'insensitive' as const } }] : []),
        ...(t.companyName ? [{ companyName: { equals: t.companyName, mode: 'insensitive' as const } }] : []),
      ],
    },
    select: { id: true, firstName: true, lastName: true, companyName: true },
  });
  return {
    propertyId: property?.id ?? null,
    unitId: unit?.id ?? null,
    unitOccupied: !!unit?.leases.length,
    tenantId: t.email || t.lastName || t.companyName ? (tenant?.id ?? null) : null,
    tenant,
  };
}
