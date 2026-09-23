export interface OpenCharge {
  id: string;
  period: string;
  outstandingCents: number;
}

export interface AllocationLine {
  chargeId: string;
  period: string;
  amountCents: number;
}

/**
 * Verteilt einen Betrag auf offene Sollstellungen.
 * Reihenfolge: zuerst die Startperiode (z. B. aus der Mitteilung erkannt),
 * danach die ältesten offenen Monate (FIFO). Ein Rest bleibt als Guthaben.
 */
export function allocate(
  amountCents: number,
  charges: OpenCharge[],
  startPeriod?: string | null,
): { lines: AllocationLine[]; remainderCents: number } {
  const open = charges.filter((c) => c.outstandingCents > 0).sort((a, b) => a.period.localeCompare(b.period));
  const ordered: OpenCharge[] = [];
  const start = startPeriod ? open.find((c) => c.period === startPeriod) : undefined;
  if (start) ordered.push(start);
  for (const c of open) if (c !== start) ordered.push(c);

  let remaining = amountCents;
  const lines: AllocationLine[] = [];
  for (const c of ordered) {
    if (remaining <= 0) break;
    const part = Math.min(remaining, c.outstandingCents);
    lines.push({ chargeId: c.id, period: c.period, amountCents: part });
    remaining -= part;
  }
  return { lines, remainderCents: remaining };
}

/** Status einer Sollstellung aus Soll, Ist und Fälligkeit */
export function chargeStatus(
  amountCents: number,
  paidCents: number,
  dueDate: Date,
  now: Date = new Date(),
  graceDays = 5,
): 'OPEN' | 'PARTIAL' | 'PAID' | 'OVERPAID' | 'OVERDUE' {
  if (paidCents > amountCents) return 'OVERPAID';
  if (paidCents === amountCents && amountCents > 0) return 'PAID';
  if (amountCents === 0) return 'PAID';
  if (paidCents > 0) return 'PARTIAL';
  const overdueAt = new Date(dueDate.getTime() + graceDays * 86400000);
  return now > overdueAt ? 'OVERDUE' : 'OPEN';
}
