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

describe('Sammelzahlung Wohnung + Parkplatz', () => {
  const apt = base({ tenantId: 'tb', leaseId: 'l-apt', firstName: 'Thomas', lastName: 'Brunner', unitLabel: '1B', monthlyCents: 155000, openCharges: [{ id: 'a10', period: '2026-10', outstandingCents: 155000, label: '1B' }] });
  const pp = base({ tenantId: 'tb', leaseId: 'l-pp', firstName: 'Thomas', lastName: 'Brunner', unitLabel: 'PP1', monthlyCents: 12000, openCharges: [{ id: 'p10', period: '2026-10', outstandingCents: 12000, label: 'PP1' }] });
  const both = { ...apt, combined: '1B + PP1', monthlyCents: 167000, openCharges: [...apt.openCharges, ...pp.openCharges] };

  it('verteilt eine Gesamtzahlung auf beide Verträge', () => {
    const r = matchTransaction({ bookingDate: new Date(Date.UTC(2026, 8, 28)), amountCents: 167000, payerName: 'Thomas Brunner', reference: 'Miete Oktober' }, [apt, pp, both]);
    expect(r.status).toBe('READY');
    expect(r.remainderCents).toBe(0);
    expect(r.allocation.map((a) => [a.label, a.amountCents]).sort()).toEqual([['1B', 155000], ['PP1', 12000]]);
    expect(r.reasons.join(' ')).toContain('1B + PP1');
  });

  it('eine reine Parkplatzzahlung geht nur auf den Parkplatz', () => {
    const r = matchTransaction({ bookingDate: new Date(Date.UTC(2026, 8, 28)), amountCents: 12000, payerName: 'Thomas Brunner' }, [apt, pp, both]);
    expect(r.leaseId).toBe('l-pp');
    expect(r.allocation).toEqual([{ chargeId: 'p10', period: '2026-10', amountCents: 12000, label: 'PP1' }]);
  });
});

describe('Jahresauszug', () => {
  const lena = base({ tenantId: 't9', leaseId: 'l9', firstName: 'Lena', lastName: 'Wyss', monthlyCents: 12000, chargesStart: '2026-09', openCharges: [
    { id: 'w9', period: '2026-09', outstandingCents: 12000 },
    { id: 'w10', period: '2026-10', outstandingCents: 12000 },
  ] });

  it('Januar-Zahlung tilgt nicht die September-Miete, wenn die Abrechnung erst im September beginnt', () => {
    const r = matchTransaction({ bookingDate: new Date(Date.UTC(2026, 0, 3)), amountCents: 12000, payerName: 'Lena Wyss', reference: 'Parkplatz' }, [lena]);
    expect(r.tenantId).toBe('t9');
    expect(r.allocation).toEqual([]);
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.reasons.some((x) => x.startsWith('Zahlung liegt vor dem Abrechnungsbeginn'))).toBe(true);
  });

  it('Vorauszahlung Ende Monat für den Folgemonat bleibt erlaubt', () => {
    const r = matchTransaction({ bookingDate: new Date(Date.UTC(2026, 7, 28)), amountCents: 12000, payerName: 'Lena Wyss', reference: 'Parkplatz' }, [lena]);
    expect(r.allocation).toEqual([{ chargeId: 'w9', period: '2026-09', amountCents: 12000 }]);
  });

  it('ausdrücklich genannter Monat darf auch weiter in der Zukunft liegen', () => {
    const r = matchTransaction({ bookingDate: new Date(Date.UTC(2026, 7, 3)), amountCents: 12000, payerName: 'Lena Wyss', reference: 'Parkplatz Oktober 2026' }, [lena]);
    expect(r.allocation[0].period).toBe('2026-10');
  });
});

describe('Namen mit abweichender Schreibweise', () => {
  const tenants = [
    base({ tenantId: 'v', leaseId: 'lv', firstName: 'Valtko', lastName: 'Mesic', monthlyCents: 5000, openCharges: [{ id: 'v3', period: '2025-03', outstandingCents: 5000 }] }),
    base({ tenantId: 's', leaseId: 'ls', firstName: 'Sylvan', lastName: 'Ernst', monthlyCents: 55000, openCharges: [{ id: 's4', period: '2025-04', outstandingCents: 55000 }] }),
    base({ tenantId: 'k', leaseId: 'lk', firstName: 'Stephanie', lastName: 'Infangr', monthlyCents: 6000, openCharges: [{ id: 'k4', period: '2025-04', outstandingCents: 6000 }] }),
  ];
  it('erkennt Vertauschungen im Vornamen und Doppelnamen', () => {
    const r = matchTransaction({ bookingDate: new Date(Date.UTC(2025, 2, 31)), amountCents: 5000, payerName: 'Vlatko Mesic-Holjevac', reference: 'Monatliche Parkgebuehr' }, tenants);
    expect(r.tenantId).toBe('v');
    expect(r.status).toBe('NEEDS_REVIEW');
  });
  it('erkennt fehlenden Buchstaben im Vornamen', () => {
    expect(matchTransaction({ bookingDate: new Date(Date.UTC(2025, 3, 2)), amountCents: 55000, payerName: 'Sylvain Ernst', reference: 'Miete Wohnung EG April 2025' }, tenants).tenantId).toBe('s');
  });
  it('erkennt Tippfehler im Nachnamen bei exaktem Vornamen', () => {
    expect(matchTransaction({ bookingDate: new Date(Date.UTC(2025, 3, 9)), amountCents: 6000, payerName: 'Infanger Stephanie', reference: 'Miete Parkplatz April 2025' }, tenants).tenantId).toBe('k');
  });
  it('verwechselt keine unterschiedlichen Personen', () => {
    const r = matchTransaction({ bookingDate: new Date(Date.UTC(2025, 3, 9)), amountCents: 6000, payerName: 'Stefan Ernstberger', reference: null }, tenants);
    expect(r.tenantId).not.toBe('s');
  });
});

describe('Betrag passt nur zu einem Mieter', () => {
  const t = [
    base({ tenantId: 'a', leaseId: 'la', firstName: 'Dora', lastName: 'Sun', monthlyCents: 130000, openCharges: [{ id: 'a4', period: '2025-04', outstandingCents: 130000 }] }),
    base({ tenantId: 'b', leaseId: 'lb', firstName: 'Bea', lastName: 'Park', monthlyCents: 5000, openCharges: [{ id: 'b4', period: '2025-04', outstandingCents: 5000 }] }),
    base({ tenantId: 'c', leaseId: 'lc', firstName: 'Cem', lastName: 'Platz', monthlyCents: 5000, openCharges: [{ id: 'c4', period: '2025-04', outstandingCents: 5000 }] }),
  ];
  it('schlägt den einzigen passenden Vertrag vor – nur zur Prüfung', () => {
    const r = matchTransaction({ bookingDate: new Date(Date.UTC(2025, 3, 1)), amountCents: 130000, payerName: 'Dominika Suntinger', reference: 'Miete Wohnung' }, t);
    expect(r.tenantId).toBe('a');
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.confidence).toBeLessThanOrEqual(60);
    expect(r.reasons[0]).toMatch(/Betrag passt nur zu/);
  });
  it('rät nicht, wenn mehrere Verträge denselben Betrag haben', () => {
    const r = matchTransaction({ bookingDate: new Date(Date.UTC(2025, 3, 1)), amountCents: 5000, payerName: 'Unbekannt Person', reference: null }, t);
    expect(r.status).toBe('UNMATCHED');
  });
});
