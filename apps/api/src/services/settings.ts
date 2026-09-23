import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export const orgSettingsSchema = z.object({
  /** Ab dieser Sicherheit gilt eine Zahlung als "Bereit zur Bestätigung" */
  autoReadyThreshold: z.number().int().min(60).max(100).default(90),
  /** Unter dieser Sicherheit wird kein Mieter vorgeschlagen */
  reviewThreshold: z.number().int().min(20).max(90).default(50),
  /** Karenztage bis eine Miete als überfällig gilt */
  overdueGraceDays: z.number().int().min(0).max(60).default(5),
  /** Vorlauf in Tagen für Hinweise auf auslaufende Verträge */
  leaseExpiryNoticeDays: z.number().int().min(7).max(365).default(90),
  /** Nach dem Verbuchen automatisch einen aktuellen Excel-Export ablegen */
  autoExcelSnapshot: z.boolean().default(true),
  /** Sollstellungen automatisch erzeugen (Monate im Voraus) */
  chargesMonthsAhead: z.number().int().min(0).max(12).default(1),
  /** Mieter über offene Mieten informieren */
  notifyTenantsOverdue: z.boolean().default(false),
});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export async function getOrgSettings(organizationId: string): Promise<OrgSettings> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
  return orgSettingsSchema.parse(org?.settings ?? {});
}
