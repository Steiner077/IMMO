/* Demo-Daten für Entwicklung und Präsentation. Nicht in Produktion ausführen. */
import { PrismaClient, type Prisma, type Role } from '@prisma/client';
import { addMonths, periodRange, toPeriod } from '@immo/shared';
import { hashPassword } from '../src/auth/password.js';
import { loadAuthUser } from '../src/auth/context.js';
import { ensureChargesForOrganization } from '../src/services/charges.js';
import { createPayment } from '../src/services/payments.js';

const prisma = new PrismaClient();
const PASSWORD = 'Immo2026!demo';
const d = (s: string) => new Date(`${s}T00:00:00Z`);

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Seed nicht in Produktion ausführen');
  const exists = await prisma.organization.findFirst();
  if (exists) {
    console.log('Datenbank enthält bereits Daten – Seed übersprungen (npm run db:reset für Neuaufbau).');
    return;
  }
  const org = await prisma.organization.create({ data: { name: 'Huber Immobilien AG', settings: {} } });
  const hash = await hashPassword(PASSWORD);

  const mkUser = (email: string, firstName: string, lastName: string, role: Role, extra: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { organizationId: org.id, email, firstName, lastName, role, passwordHash: hash, ...extra } });

  await mkUser('superadmin@immo.local', 'System', 'Administrator', 'SUPER_ADMIN');
  const owner = await mkUser('eigentuemer@immo.local', 'Stefan', 'Huber', 'OWNER', { phone: '+41 79 100 20 30' });
  const manager = await mkUser('verwaltung@immo.local', 'Claudia', 'Widmer', 'MANAGER', { phone: '+41 44 200 30 40' });

  // ───── Immobilien ─────
  const p1 = await prisma.property.create({
    data: {
      organizationId: org.id, name: 'Seestrasse 12', street: 'Seestrasse 12', zip: '8002', city: 'Zürich', type: 'RESIDENTIAL', yearBuilt: 1968, purchasePriceCents: 480000000,
      description: 'Mehrfamilienhaus mit 7 Wohnungen und Parkplatz, 2019 energetisch saniert.',
      tenantInfo: 'Kehricht: Dienstag und Freitag ab 07:00 Uhr bereitstellen.\nWaschküche: Reservation über den Plan im UG.\nNotfall Heizung/Wasser ausserhalb der Bürozeiten: 044 555 00 11',
    },
  });
  const p2 = await prisma.property.create({
    data: {
      organizationId: org.id, name: 'Wohnpark Lindenhof', street: 'Bahnhofstrasse 5', zip: '8400', city: 'Winterthur', type: 'RESIDENTIAL', yearBuilt: 2004, purchasePriceCents: 620000000,
      tenantInfo: 'Tiefgarage: Tor schliesst automatisch um 22:00 Uhr.\nVelo-Raum im EG, Zugang mit Wohnungsschlüssel.',
    },
  });
  const p3 = await prisma.property.create({
    data: { organizationId: org.id, name: 'Gewerbehaus Oerlikon', street: 'Binzmühlestrasse 80', zip: '8050', city: 'Zürich', type: 'COMMERCIAL', yearBuilt: 1991, purchasePriceCents: 350000000 },
  });

  const employee = await mkUser('mitarbeiter@immo.local', 'Reto', 'Kunz', 'EMPLOYEE', { propertyAccess: { create: [{ propertyId: p2.id }] } });
  const caretaker = await mkUser('hauswart@immo.local', 'Bruno', 'Gerber', 'CARETAKER', { phone: '+41 79 555 66 77', propertyAccess: { create: [{ propertyId: p1.id }, { propertyId: p2.id }] } });

  const unit = (propertyId: string, label: string, type: 'APARTMENT' | 'COMMERCIAL' | 'OFFICE' | 'PARKING', rooms: number | null, areaM2: number | null, floor: string, targetRentCents: number) =>
    prisma.unit.create({ data: { propertyId, label, type, rooms, areaM2, floor, targetRentCents } });

  const u = {
    '1A': await unit(p1.id, '1A', 'APARTMENT', 3.5, 78, '1. OG', 145000),
    '1B': await unit(p1.id, '1B', 'APARTMENT', 3.5, 74, '1. OG', 138000),
    '2A': await unit(p1.id, '2A', 'APARTMENT', 4.5, 92, '2. OG', 162000),
    '2B': await unit(p1.id, '2B', 'APARTMENT', 3.5, 72, '2. OG', 132000),
    '3A': await unit(p1.id, '3A', 'APARTMENT', 4.5, 95, '3. OG', 165000),
    '3B': await unit(p1.id, '3B', 'APARTMENT', 4.5, 97, '3. OG', 170000),
    '4A': await unit(p1.id, '4A', 'APARTMENT', 5.5, 128, 'DG', 240000),
    PP1: await unit(p1.id, 'PP1', 'PARKING', null, 12, 'Aussen', 12000),
    A1: await unit(p2.id, 'A1', 'APARTMENT', 4.5, 105, 'EG', 210000),
    A2: await unit(p2.id, 'A2', 'APARTMENT', 3.5, 86, '1. OG', 189000),
    A3: await unit(p2.id, 'A3', 'APARTMENT', 3.5, 84, '1. OG', 175000),
    A4: await unit(p2.id, 'A4', 'APARTMENT', 4.5, 108, '2. OG', 225000),
    A5: await unit(p2.id, 'A5', 'APARTMENT', 4.5, 104, '2. OG', 198000),
    A6: await unit(p2.id, 'A6', 'APARTMENT', 2.5, 58, 'Attika', 165000),
    EG: await unit(p3.id, 'EG Laden', 'COMMERCIAL', null, 140, 'EG', 380000),
    OG1: await unit(p3.id, '1. OG Büro', 'OFFICE', null, 180, '1. OG', 420000),
    OG2: await unit(p3.id, '2. OG Büro', 'OFFICE', null, 180, '2. OG', 420000),
  };

  // ───── Mieter & Verträge ─────
  const specs = [
    { key: '1A', first: 'Sandra', last: 'Meier', email: 'sandra.meier@example.ch', phone: '+41 79 311 22 33', net: 145000, util: 18000, start: '2019-04-01' },
    { key: '1B', first: 'Thomas', last: 'Brunner', email: 'thomas.brunner@example.ch', net: 138000, util: 17000, start: '2021-10-01' },
    { key: '2A', first: 'Laura', last: 'Schneider', email: 'laura.schneider@example.ch', net: 162000, util: 19000, start: '2020-02-01' },
    { key: '2B', first: 'Mario', last: 'Arnold', email: 'mario.arnold@example.ch', net: 132000, util: 18000, start: '2023-06-01' },
    { key: '3A', first: 'Peter', last: 'Müller', email: 'peter.mueller@example.ch', phone: '+41 78 123 45 67', net: 165000, util: 20000, start: '2018-09-01', ref: 'RF18 0000 3A12' },
    { key: '3B', first: 'Monika', last: 'Keller', email: 'monika.keller@example.ch', net: 170000, util: 21000, start: '2022-03-01' },
    { key: 'A1', first: 'Marco', last: 'Rossi', email: 'marco.rossi@example.ch', net: 210000, util: 25000, start: '2017-07-01' },
    { key: 'A2', first: 'Julia', last: 'Weber', email: 'julia.weber@example.ch', net: 189000, util: 22000, start: '2026-04-15', iban: 'CH4431999123000889012' },
    { key: 'A3', first: 'Daniel', last: 'Frei', email: 'daniel.frei@example.ch', net: 175000, util: 20000, start: '2021-01-01', end: '2026-11-30' },
    { key: 'A4', first: 'Nicole', last: 'Baumann', email: 'nicole.baumann@example.ch', net: 225000, util: 26000, start: '2024-05-01' },
    { key: 'A5', first: 'Luca', last: 'Bernasconi', email: 'luca.bernasconi@example.ch', net: 198000, util: 23000, start: '2019-11-01' },
    { key: 'EG', company: 'Bäckerei Sonnenschein GmbH', email: 'info@sonnenschein-baeckerei.ch', net: 380000, util: 45000, start: '2016-01-01' },
    { key: 'OG1', company: 'Kreativ Studio AG', email: 'office@kreativstudio.ch', net: 420000, util: 50000, start: '2020-01-01', end: '2026-12-31' },
  ] as const;

  const tenants: Record<string, { id: string; leaseId: string }> = {};
  for (const s of specs) {
    const t = await prisma.tenant.create({
      data: {
        organizationId: org.id,
        isCompany: 'company' in s,
        firstName: 'first' in s ? s.first : null,
        lastName: 'last' in s ? s.last : null,
        companyName: 'company' in s ? s.company : null,
        email: s.email,
        phone: 'phone' in s ? s.phone : null,
        iban: 'iban' in s ? s.iban : null,
      },
    });
    const lease = await prisma.lease.create({
      data: {
        unitId: u[s.key as keyof typeof u].id,
        tenantId: t.id,
        status: 'end' in s ? 'TERMINATED' : 'ACTIVE',
        startDate: d(s.start),
        chargesFrom: d(s.start) > d('2026-01-01') ? null : d('2026-01-01'),
        endDate: 'end' in s ? d(s.end) : null,
        terminatedAt: 'end' in s ? d('2026-06-15') : null,
        netRentCents: s.net,
        utilitiesCents: s.util,
        depositCents: s.net * 3,
        paymentReference: 'ref' in s ? s.ref : null,
      },
    });
    tenants[s.key] = { id: t.id, leaseId: lease.id };
  }
  // Zweiter Vertrag: Parkplatz für Thomas Brunner
  const pp = await prisma.lease.create({ data: { unitId: u.PP1.id, tenantId: tenants['1B'].id, startDate: d('2022-01-01'), chargesFrom: d('2026-01-01'), netRentCents: 12000, utilitiesCents: 0 } });

  // Mieter-App-Zugänge
  await mkUser('mieter@immo.local', 'Peter', 'Müller', 'TENANT', { tenantId: tenants['3A'].id });
  await mkUser('mieter2@immo.local', 'Monika', 'Keller', 'TENANT', { tenantId: tenants['3B'].id });

  // Dienstleister
  const sp1 = await prisma.serviceProvider.create({ data: { organizationId: org.id, name: 'Sanitär Hofmann AG', trade: 'Sanitär / Heizung', contactName: 'Urs Hofmann', email: 'auftrag@hofmann-sanitaer.ch', phone: '+41 44 310 20 20', city: 'Zürich' } });
  const sp2 = await prisma.serviceProvider.create({ data: { organizationId: org.id, name: 'Lift Service Schweiz', trade: 'Aufzüge', phone: '+41 52 222 33 44', city: 'Winterthur' } });
  await prisma.serviceProvider.create({ data: { organizationId: org.id, name: 'Elektro Blitz GmbH', trade: 'Elektro', phone: '+41 44 777 88 99', city: 'Zürich' } });
  await prisma.serviceProvider.create({ data: { organizationId: org.id, name: 'Clean & Co. Reinigungen', trade: 'Reinigung', phone: '+41 44 123 00 00', city: 'Zürich' } });
  await mkUser('handwerker@immo.local', 'Urs', 'Hofmann', 'SERVICE_PROVIDER', { serviceProviderId: sp1.id });

  // ───── Sollstellungen & Zahlungshistorie ─────
  await ensureChargesForOrganization(org.id, '2026-10', prisma);
  const actor = { user: (await loadAuthUser(owner.id))! };
  const today = new Date('2026-09-23T00:00:00Z');

  const leases = await prisma.lease.findMany({ include: { tenant: true, charges: { where: { period: { gte: '2026-01', lte: '2026-09' } }, orderBy: { period: 'asc' } } } });
  const septemberPaid = new Set(['1A', '1B', 'A1', 'A5', 'OG1', 'PP']);
  const keyOf = (leaseId: string) => (leaseId === pp.id ? 'PP' : Object.entries(tenants).find(([, v]) => v.leaseId === leaseId)?.[0]);

  let seedDay = 0;
  for (const l of leases) {
    const key = keyOf(l.id)!;
    const name = l.tenant.companyName ?? `${l.tenant.firstName} ${l.tenant.lastName}`;
    for (const c of l.charges) {
      if (c.period === '2026-09' && !septemberPaid.has(key)) continue;
      if (key === 'A4' && (c.period === '2026-07' || c.period === '2026-08')) continue; // Nicole Baumann: überfällig
      let amount = c.amountCents;
      if (key === '3B' && c.period === '2026-08') amount = 100000; // Teilzahlung
      seedDay = (seedDay + 3) % 5;
      const offset = key === 'A1' || key === 'OG1' ? -3 : key === '1A' ? 0 : seedDay;
      const booking = new Date(c.dueDate.getTime() + offset * 86400000);
      if (booking > today) continue;
      const [y, m] = c.period.split('-');
      const monthName = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][+m - 1];
      await createPayment(
        {
          organizationId: org.id,
          leaseId: l.id,
          bookingDate: booking,
          amountCents: amount,
          method: key === 'A1' || key === 'OG1' || key === '1A' ? 'STANDING_ORDER' : 'BANK_TRANSFER',
          payerName: name,
          reference: `Miete ${monthName} ${y}`,
          source: 'MANUAL',
          confidence: null,
          allocations: [{ chargeId: c.id, amountCents: amount }],
        },
        actor,
      );
    }
  }
  // Gelernte Zuordnung aus der Vergangenheit (Lernlogik)
  await prisma.payerAlias.create({ data: { organizationId: org.id, normalizedName: 'l schneider', tenantId: tenants['2A'].id, leaseId: tenants['2A'].leaseId, timesConfirmed: 3 } });

  // ───── Ausgaben ─────
  for (const period of periodRange('2026-01', '2026-09')) {
    const date = d(`${period}-25`);
    await prisma.expense.createMany({
      data: [
        { organizationId: org.id, propertyId: p1.id, category: 'CARETAKER', date, amountCents: 95000, description: 'Hauswartung monatlich', createdById: manager.id },
        { organizationId: org.id, propertyId: p2.id, category: 'CARETAKER', date, amountCents: 110000, description: 'Hauswartung monatlich', createdById: manager.id },
        { organizationId: org.id, propertyId: p1.id, category: 'MORTGAGE', date, amountCents: 420000, description: 'Hypothekarzins', createdById: manager.id },
        { organizationId: org.id, propertyId: p2.id, category: 'MORTGAGE', date, amountCents: 510000, description: 'Hypothekarzins', createdById: manager.id },
        { organizationId: org.id, propertyId: p3.id, category: 'MORTGAGE', date, amountCents: 280000, description: 'Hypothekarzins', createdById: manager.id },
        { organizationId: org.id, propertyId: p3.id, category: 'CLEANING', date, amountCents: 38000, description: 'Treppenhausreinigung', serviceProviderId: null, createdById: manager.id },
        { organizationId: org.id, propertyId: p1.id, category: 'ELECTRICITY', date, amountCents: 21000 + (+period.slice(5) % 3) * 4000, description: 'Allgemeinstrom', createdById: manager.id },
      ],
    });
  }
  await prisma.expense.createMany({
    data: [
      { organizationId: org.id, propertyId: p1.id, category: 'INSURANCE', date: d('2026-01-15'), amountCents: 684000, description: 'Gebäudeversicherung 2026', invoiceNumber: 'GV-2026-118', createdById: manager.id },
      { organizationId: org.id, propertyId: p2.id, category: 'INSURANCE', date: d('2026-01-15'), amountCents: 812000, description: 'Gebäudeversicherung 2026', createdById: manager.id },
      { organizationId: org.id, propertyId: p2.id, category: 'REPAIR', date: d('2026-05-12'), amountCents: 245000, description: 'Reparatur Garagentor', serviceProviderId: null, createdById: manager.id },
      { organizationId: org.id, propertyId: p1.id, category: 'CRAFTSMEN', date: d('2026-07-03'), amountCents: 138000, description: 'Ersatz Boiler Wohnung 1B', serviceProviderId: sp1.id, createdById: manager.id },
      { organizationId: org.id, propertyId: p2.id, category: 'WATER', date: d('2026-06-30'), amountCents: 196000, description: 'Wasser/Abwasser 1. Halbjahr', createdById: manager.id },
    ],
  });

  // ───── Mängel ─────
  const mkDamage = async (n: number, data: Omit<Prisma.DamageReportUncheckedCreateInput, 'organizationId' | 'ticketNumber'>, events: [string, string][]) => {
    const r = await prisma.damageReport.create({ data: { organizationId: org.id, ticketNumber: n, ...data } });
    for (const [type, message] of events) await prisma.damageReportEvent.create({ data: { damageReportId: r.id, type, message, userId: manager.id } });
    return r;
  };
  await prisma.counter.create({ data: { organizationId: org.id, key: 'ticket', value: 1048 } });
  await mkDamage(1048, { propertyId: p1.id, unitId: u['2A'].id, tenantId: tenants['2A'].id, category: 'HEATING', title: 'Heizung funktioniert nicht', description: 'Seit gestern Abend bleiben alle Heizkörper kalt. Thermostat auf Stufe 5.', priority: 'HIGH', status: 'NEW', preferredAppointment: 'Werktags ab 17 Uhr', createdAt: new Date('2026-09-22T18:40:00Z') }, [['CREATED', 'Ticket #1048 erstellt']]);
  const dm2 = await mkDamage(1047, { propertyId: p1.id, unitId: u['3A'].id, tenantId: tenants['3A'].id, category: 'BATHROOM', title: 'Wasserhahn im Bad tropft', description: 'Der Wasserhahn am Lavabo tropft auch wenn er ganz zugedreht ist.', priority: 'LOW', status: 'IN_PROGRESS', assignedCaretakerId: caretaker.id, createdAt: new Date('2026-09-15T09:10:00Z') }, [['CREATED', 'Ticket #1047 erstellt'], ['ASSIGNED', 'Hauswart zugewiesen: Bruno Gerber'], ['STATUS_CHANGED', 'Status: Neu → In Bearbeitung']]);
  await mkDamage(1046, { propertyId: p2.id, category: 'COMMON_AREAS', title: 'Lift bleibt zwischen 1. und 2. OG stehen', description: 'Der Lift stoppt sporadisch. Notruf wurde nicht ausgelöst.', priority: 'URGENT', status: 'WAITING', serviceProviderId: sp2.id, estimatedCostCents: 180000, createdAt: new Date('2026-09-10T07:30:00Z') }, [['CREATED', 'Ticket #1046 erstellt'], ['PROVIDER_ASSIGNED', 'Handwerker beauftragt: Lift Service Schweiz'], ['STATUS_CHANGED', 'Status: In Bearbeitung → Wartet (Ersatzteil bestellt)']]);
  await mkDamage(1045, { propertyId: p2.id, unitId: u.A4.id, tenantId: tenants.A4.id, category: 'WINDOWS_DOORS', title: 'Fenster im Schlafzimmer undicht', description: 'Bei Regen tritt Wasser am Fensterrahmen ein.', priority: 'MEDIUM', status: 'RESOLVED', resolvedAt: new Date('2026-08-28T10:00:00Z'), createdAt: new Date('2026-08-12T10:00:00Z') }, [['CREATED', 'Ticket #1045 erstellt'], ['STATUS_CHANGED', 'Status: In Bearbeitung → Erledigt']]);
  await mkDamage(1044, { propertyId: p1.id, unitId: u['1B'].id, tenantId: tenants['1B'].id, category: 'APPLIANCES', title: 'Geschirrspüler zeigt Fehler E24', description: 'Abpumpen funktioniert nicht.', priority: 'MEDIUM', status: 'CLOSED', serviceProviderId: sp1.id, resolvedAt: new Date('2026-07-05T10:00:00Z'), createdAt: new Date('2026-06-28T10:00:00Z') }, [['CREATED', 'Ticket #1044 erstellt']]);

  // ───── Aufgaben & Termine ─────
  await prisma.task.createMany({
    data: [
      { organizationId: org.id, title: 'Heizungsmonteur für Ticket #1048 aufbieten', priority: 'HIGH', dueDate: d('2026-09-24'), assigneeId: manager.id, createdById: owner.id, propertyId: p1.id },
      { organizationId: org.id, title: 'Nebenkostenabrechnung 2025/26 erstellen', priority: 'MEDIUM', dueDate: d('2026-10-31'), assigneeId: manager.id, createdById: owner.id },
      { organizationId: org.id, title: 'Wohnungsabnahme A3 (Daniel Frei) planen', priority: 'MEDIUM', dueDate: d('2026-11-15'), assigneeId: employee.id, createdById: manager.id, propertyId: p2.id, unitId: u.A3.id },
      { organizationId: org.id, title: 'Mahnung Nicole Baumann (Juli/August)', priority: 'HIGH', dueDate: d('2026-09-25'), assigneeId: manager.id, createdById: owner.id, propertyId: p2.id, tenantId: tenants.A4.id },
      { organizationId: org.id, title: 'Inserat Wohnung 4A aufschalten', priority: 'MEDIUM', dueDate: d('2026-09-30'), assigneeId: manager.id, createdById: owner.id, propertyId: p1.id, unitId: u['4A'].id },
      { organizationId: org.id, title: 'Rasenmähen & Heckenschnitt', priority: 'LOW', status: 'DONE', completedAt: d('2026-09-12'), assigneeId: caretaker.id, createdById: manager.id, propertyId: p1.id },
    ],
  });
  await prisma.appointment.createMany({
    data: [
      { organizationId: org.id, title: 'Reparatur Wasserhahn', startAt: new Date('2026-09-25T08:00:00Z'), endAt: new Date('2026-09-25T09:00:00Z'), location: 'Seestrasse 12, Wohnung 3A', propertyId: p1.id, unitId: u['3A'].id, tenantId: tenants['3A'].id, damageReportId: dm2.id, visibleToTenant: true, createdById: manager.id },
      { organizationId: org.id, title: 'Besichtigung Wohnung 4A', startAt: new Date('2026-09-29T16:00:00Z'), location: 'Seestrasse 12, DG', propertyId: p1.id, unitId: u['4A'].id, createdById: manager.id },
      { organizationId: org.id, title: 'Liftrevision', startAt: new Date('2026-10-02T07:00:00Z'), endAt: new Date('2026-10-02T11:00:00Z'), location: 'Wohnpark Lindenhof', propertyId: p2.id, createdById: manager.id },
      { organizationId: org.id, title: 'Eigentümerversammlung', startAt: new Date('2026-10-08T17:30:00Z'), location: 'Büro Huber Immobilien', createdById: owner.id },
    ],
  });
  await prisma.announcement.createMany({
    data: [
      { organizationId: org.id, propertyId: p1.id, title: 'Wasserunterbruch am 2. Oktober', body: 'Wegen Arbeiten an der Hauptleitung ist die Wasserversorgung am 2. Oktober von 08:00 bis 11:00 Uhr unterbrochen.', important: true, createdById: manager.id },
      { organizationId: org.id, title: 'Neue Mieter-App verfügbar', body: 'Ab sofort können Sie Mängel, Dokumente und Nachrichten bequem über die Mieter-App erledigen.', createdById: manager.id },
    ],
  });

  // ───── Nachrichten ─────
  const peterUser = await prisma.user.findUniqueOrThrow({ where: { email: 'mieter@immo.local' } });
  await prisma.conversation.create({
    data: {
      organizationId: org.id,
      subject: 'Frage zum Parkplatz',
      tenantId: tenants['3A'].id,
      propertyId: p1.id,
      unitId: u['3A'].id,
      lastMessageAt: new Date('2026-09-21T14:05:00Z'),
      participants: { create: [{ userId: peterUser.id, lastReadAt: new Date('2026-09-21T14:05:00Z') }, { userId: manager.id }] },
      messages: {
        create: [
          { senderId: peterUser.id, body: 'Guten Tag, ist der Aussenparkplatz PP1 ab nächstem Jahr frei? Ich hätte Interesse.', createdAt: new Date('2026-09-20T09:12:00Z') },
          { senderId: manager.id, body: 'Guten Tag Herr Müller, PP1 ist derzeit vermietet. Ich setze Sie gerne auf die Warteliste.', createdAt: new Date('2026-09-20T11:30:00Z') },
          { senderId: peterUser.id, body: 'Sehr gerne, vielen Dank!', createdAt: new Date('2026-09-21T14:05:00Z') },
        ],
      },
    },
  });
  await prisma.conversation.create({
    data: {
      organizationId: org.id,
      subject: 'Lift Wohnpark Lindenhof',
      propertyId: p2.id,
      lastMessageAt: new Date('2026-09-18T08:00:00Z'),
      participants: { create: [{ userId: manager.id, lastReadAt: new Date() }, { userId: caretaker.id }] },
      messages: { create: [{ senderId: manager.id, body: 'Bruno, bitte Lift-Warnschild im EG anbringen, bis das Ersatzteil da ist.', createdAt: new Date('2026-09-18T08:00:00Z') }] },
    },
  });

  console.log('✔ Demo-Daten erstellt.');
  console.log(`  Passwort für alle Demo-Benutzer: ${PASSWORD}`);
  console.log('  Verwaltung: eigentuemer@immo.local · verwaltung@immo.local · mitarbeiter@immo.local · hauswart@immo.local · handwerker@immo.local');
  console.log('  Mieter-App: mieter@immo.local (Peter Müller) · mieter2@immo.local (Monika Keller)');
  void addMonths;
  void toPeriod;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
