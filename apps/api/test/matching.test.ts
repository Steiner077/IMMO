import { describe, expect, it } from 'vitest';
import { matchTransaction, detectPeriods, type MatchCandidate } from '../src/import/matching.js';
import { allocate, chargeStatus } from '../src/import/allocation.js';

const base = (over: Partial<MatchCandidate>): MatchCandidate => ({
  tenantId: 't1',
  leaseId: 'l1',
  firstName: 'Peter',
  lastName: 'Müller',
  unitLabel: '3A',
  propertyName: 'Seestrasse 12',
  monthlyCents: 185000,
  openCharges: [{ id: 'c9', period: '2026-09', outstandingCents: 185000 }],
  aliases: [],
  ...over,
});

const candidates: MatchCandidate[] = [
  base({}),
  base({ tenantId: 't2', leaseId: 'l2', firstName: 'Mario', lastName: 'Arnold', unitLabel: '2B', monthlyCents: 150000, openCharges: [{ id: 'd9', period: '2026-09', outstandingCents: 150000 }] }),
  base({ tenantId: 't3', leaseId: 'l3', firstName: 'Anna', lastName: 'Keller', unitLabel: '1A', monthlyCents: 210000, iban: 'CH93 0076 2011 6238 5295 7', openCharges: [
    { id: 'e8', period: '2026-08', outstandingCents: 210000 },
    { id: 'e9', period: '2026-09', outstandingCents: 210000 },
  ] }),
];

describe('matchTransaction', () => {
  it('erkennt Peter Müller mit hoher Sicherheit', () => {
    const r = matchTransaction(
      { bookingDate: new Date(Date.UTC(2026, 8, 3)), amountCents: 185000, payerName: 'Peter Müller', reference: 'Mietzins September Wohnung 3A' },
      candidates,
    );
    expect(r.tenantId).toBe('t1');
    expect(r.period).toBe('2026-09');
    expect(r.confidence).toBeGreaterThanOrEqual(95);
    expect(r.status).toBe('READY');
    expect(r.allocation).toEqual([{ chargeId: 'c9', period: '2026-09', amountCents: 185000 }]);
  });

  it('Initiale + Nachname ohne gelernte Zuordnung muss geprüft werden', () => {
    const r = matchTransaction({ bookingDate: new Date(Date.UTC(2026, 8, 2)), amountCents: 150000, payerName: 'M. Arnold' }, candidates);
    expect(r.tenantId).toBe('t2');
    expect(r.status).toBe('NEEDS_REVIEW');
  });

  it('gelernte Zuordnung "M. Arnold" wird berücksichtigt', () => {
    const learned = candidates.map((c) => (c.tenantId === 't2' ? { ...c, aliases: [{ normalizedName: 'm arnold', timesConfirmed: 1 }] } : c));
    const r = matchTransaction({ bookingDate: new Date(Date.UTC(2026, 8, 2)), amountCents: 150000, payerName: 'M. Arnold' }, learned);
    expect(r.tenantId).toBe('t2');
    expect(r.status).toBe('READY');
  });

  it('IBAN-Treffer und Zahlung für zwei Monate', () => {
    const r = matchTransaction({ bookingDate: new Date(Date.UTC(2026, 8, 5)), amountCents: 420000, payerName: 'A Keller-Huber', payerIban: 'CH9300762011623852957' }, candidates);
    expect(r.tenantId).toBe('t3');
    expect(r.allocation.map((a) => a.period)).toEqual(['2026-08', '2026-09']);
    expect(r.remainderCents).toBe(0);
  });

  it('unbekannter Zahler bleibt unklar', () => {
    const r = matchTransaction({ bookingDate: new Date(), amountCents: 99900, payerName: 'Unbekannt AG' }, candidates);
    expect(r.status).toBe('UNMATCHED');
    expect(r.tenantId).toBeNull();
  });

  it('Teilzahlung wird nie automatisch bereitgestellt', () => {
    const r = matchTransaction({ bookingDate: new Date(Date.UTC(2026, 8, 3)), amountCents: 100000, payerName: 'Peter Müller' }, candidates);
    expect(r.status).toBe('NEEDS_REVIEW');
  });
});

describe('detectPeriods', () => {
  it('erkennt Monatsnamen und Zahlenformate', () => {
    const d = new Date(Date.UTC(2026, 8, 3));
    expect(detectPeriods('Mietzins September', d)).toEqual(['2026-09']);
    expect(detectPeriods('Miete 10/2026', d)).toEqual(['2026-10']);
    expect(detectPeriods('Miete Januar', new Date(Date.UTC(2026, 11, 28)))).toEqual(['2027-01']);
    expect(detectPeriods('Jan Meier Miete', d)).toEqual([]);
  });
});

describe('allocate', () => {
  it('beginnt mit der Startperiode und verteilt dann FIFO', () => {
    const r = allocate(250000, [
      { id: 'a', period: '2026-07', outstandingCents: 100000 },
      { id: 'b', period: '2026-08', outstandingCents: 100000 },
      { id: 'c', period: '2026-09', outstandingCents: 100000 },
    ], '2026-09');
    expect(r.lines).toEqual([
      { chargeId: 'c', period: '2026-09', amountCents: 100000 },
      { chargeId: 'a', period: '2026-07', amountCents: 100000 },
      { chargeId: 'b', period: '2026-08', amountCents: 50000 },
    ]);
    expect(r.remainderCents).toBe(0);
  });
  it('Überzahlung bleibt als Restbetrag', () => {
    expect(allocate(120000, [{ id: 'a', period: '2026-09', outstandingCents: 100000 }]).remainderCents).toBe(20000);
  });
});

describe('chargeStatus', () => {
  const due = new Date(Date.UTC(2026, 8, 1));
  it.each([
    [1000, 0, new Date(Date.UTC(2026, 8, 2)), 'OPEN'],
    [1000, 0, new Date(Date.UTC(2026, 8, 20)), 'OVERDUE'],
    [1000, 500, new Date(Date.UTC(2026, 8, 20)), 'PARTIAL'],
    [1000, 1000, new Date(Date.UTC(2026, 8, 20)), 'PAID'],
    [1000, 1200, new Date(Date.UTC(2026, 8, 20)), 'OVERPAID'],
  ])('%i/%i → %s', (amount, paid, now, expected) => {
    expect(chargeStatus(amount, paid, due, now)).toBe(expected);
  });
});
