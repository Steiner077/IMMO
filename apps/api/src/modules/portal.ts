import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { toPeriod } from '@immo/shared';
import { prisma } from '../lib/prisma.js';
import { idParam, optStr, parse } from '../lib/http.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { readMultipart } from '../lib/upload.js';
import { storeDocument } from '../services/documents.js';
import { createConversation, getConversation, listConversations, sendMessage } from '../services/messages.js';
import { notifyStaff } from '../services/notifications.js';
import { DAMAGE_CATEGORY_ENUM, PRIORITY_ENUM, addDamageEvent, createDamageReport } from './damages.js';
import { documentScope } from './documents.js';

/**
 * Mieter-App-API. Jeder Endpunkt ist strikt auf den angemeldeten Mieter
 * beschränkt (tenantId aus dem Token – nie aus Parametern).
 */
function tenantIdOf(req: FastifyRequest): string {
  if (req.user.role !== 'TENANT' || !req.user.tenantId) throw forbidden('Nur für Mieter');
  return req.user.tenantId;
}

async function activeLeases(tenantId: string) {
  return prisma.lease.findMany({
    where: { tenantId, status: { in: ['ACTIVE', 'TERMINATED'] } },
    include: { unit: { include: { property: true } } },
    orderBy: { startDate: 'desc' },
  });
}

export async function portalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    tenantIdOf(req);
  });

  app.get('/overview', async (req) => {
    const tenantId = tenantIdOf(req);
    const period = toPeriod(new Date());
    const leases = await activeLeases(tenantId);
    const propertyIds = leases.map((l) => l.unit.propertyId);
    const [tenant, currentCharges, openCharges, recentPayments, openDamages, appointments, announcements, conversations] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { firstName: true, lastName: true, companyName: true } }),
      prisma.rentCharge.findMany({ where: { lease: { tenantId }, period, status: { not: 'CANCELLED' } } }),
      prisma.rentCharge.findMany({ where: { lease: { tenantId }, status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] }, dueDate: { lte: new Date() } }, orderBy: { period: 'asc' } }),
      prisma.payment.findMany({ where: { tenantId, reversedAt: null }, orderBy: { bookingDate: 'desc' }, take: 3, select: { id: true, bookingDate: true, amountCents: true, status: true } }),
      prisma.damageReport.count({ where: { tenantId, status: { in: ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'WAITING'] } } }),
      prisma.appointment.findMany({ where: { tenantId, visibleToTenant: true, startAt: { gte: new Date() } }, orderBy: { startAt: 'asc' }, take: 3 }),
      prisma.announcement.findMany({
        where: { organizationId: req.user.organizationId, OR: [{ propertyId: null }, { propertyId: { in: propertyIds } }], AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] }] },
        orderBy: [{ important: 'desc' }, { publishedAt: 'desc' }],
        take: 3,
      }),
      listConversations(req.user),
    ]);
    return {
      tenant,
      leases: leases.map((l) => ({
        id: l.id,
        unit: { label: l.unit.label, type: l.unit.type, rooms: l.unit.rooms, floor: l.unit.floor },
        property: { name: l.unit.property.name, street: l.unit.property.street, zip: l.unit.property.zip, city: l.unit.property.city },
        netRentCents: l.netRentCents,
        utilitiesCents: l.utilitiesCents,
        totalCents: l.netRentCents + l.utilitiesCents,
        paymentReference: l.paymentReference,
        startDate: l.startDate,
        endDate: l.endDate,
        status: l.status,
      })),
      currentMonth: {
        period,
        amountCents: currentCharges.reduce((s, c) => s + c.amountCents, 0),
        paidCents: currentCharges.reduce((s, c) => s + c.paidCents, 0),
        status: currentCharges[0]?.status ?? null,
      },
      openCents: openCharges.reduce((s, c) => s + c.amountCents - c.paidCents, 0),
      openPeriods: openCharges.map((c) => ({ period: c.period, openCents: c.amountCents - c.paidCents, status: c.status })),
      recentPayments,
      openDamages,
      appointments,
      announcements,
      unreadMessages: conversations.filter((c) => c.unread).length,
    };
  });

  app.get('/lease', async (req) => {
    const tenantId = tenantIdOf(req);
    const leases = await prisma.lease.findMany({
      where: { tenantId },
      include: { unit: { include: { property: { select: { name: true, street: true, zip: true, city: true } } } }, documents: { where: { deletedAt: null, visibleToTenant: true } } },
      orderBy: { startDate: 'desc' },
    });
    return leases.map(({ notes: _n, ...l }) => l);
  });

  app.get('/payments', async (req) => {
    const tenantId = tenantIdOf(req);
    const [charges, payments] = await Promise.all([
      prisma.rentCharge.findMany({
        where: { lease: { tenantId }, status: { not: 'CANCELLED' }, dueDate: { lte: new Date(Date.now() + 40 * 86400000) } },
        orderBy: { period: 'desc' },
        select: { id: true, period: true, dueDate: true, amountCents: true, paidCents: true, status: true, lease: { select: { unit: { select: { label: true } } } } },
      }),
      prisma.payment.findMany({
        where: { tenantId },
        orderBy: { bookingDate: 'desc' },
        select: { id: true, number: true, bookingDate: true, amountCents: true, status: true, reference: true, reversedAt: true, assignments: { select: { amountCents: true, rentCharge: { select: { period: true } } } } },
      }),
    ]);
    const due = charges.filter((c) => c.dueDate <= new Date());
    return {
      charges,
      payments,
      summary: {
        openCents: due.reduce((s, c) => s + Math.max(0, c.amountCents - c.paidCents), 0),
        paidTotalCents: payments.filter((p) => !p.reversedAt).reduce((s, p) => s + p.amountCents, 0),
      },
    };
  });

  app.get('/documents', async (req) => {
    tenantIdOf(req);
    return prisma.document.findMany({
      where: documentScope(req.user),
      select: { id: true, name: true, category: true, mimeType: true, sizeBytes: true, createdAt: true, uploadedById: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.get('/documents/:id/download', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const d = await prisma.document.findFirst({ where: { id, ...documentScope(req.user) } });
    if (!d) throw notFound('Dokument');
    const { storage } = await import('../lib/storage.js');
    reply.header('Content-Type', d.mimeType);
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(d.name)}`);
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(storage.stream(d.storageKey));
  });

  app.post('/documents', async (req) => {
    const tenantId = tenantIdOf(req);
    const leases = await activeLeases(tenantId);
    const { files, fields } = await readMultipart(req);
    if (!files.length) throw badRequest('Keine Datei übermittelt.');
    const docs = [];
    for (const f of files) {
      docs.push(
        await storeDocument(prisma, req.user.organizationId, f, {
          tenantId,
          propertyId: leases[0]?.unit.propertyId ?? null,
          unitId: leases[0]?.unitId ?? null,
          description: fields.description ?? 'Vom Mieter hochgeladen',
          category: fields.category === 'CORRESPONDENCE' ? 'CORRESPONDENCE' : null,
          visibleToTenant: true,
          uploadedById: req.user.id,
        }),
      );
    }
    await notifyStaff({
      organizationId: req.user.organizationId,
      type: 'DOCUMENT_UPLOADED',
      title: 'Mieter hat Dokument hochgeladen',
      body: `${req.user.firstName} ${req.user.lastName}: ${docs.map((d) => d.name).join(', ')}`,
      link: `/mieter/${tenantId}`,
      propertyId: leases[0]?.unit.propertyId,
    });
    return docs;
  });

  // ───── Mängel ─────
  app.get('/damages', async (req) => {
    const tenantId = tenantIdOf(req);
    return prisma.damageReport.findMany({
      where: { tenantId },
      select: { id: true, ticketNumber: true, title: true, category: true, priority: true, status: true, createdAt: true, updatedAt: true, unit: { select: { label: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.post('/damages', async (req) => {
    const tenantId = tenantIdOf(req);
    const { fields, files } = await readMultipart(req);
    const input = parse(
      z.object({
        leaseId: optStr,
        category: DAMAGE_CATEGORY_ENUM,
        title: z.string().trim().min(3).max(200),
        description: z.string().trim().min(3).max(5000),
        priority: PRIORITY_ENUM.default('MEDIUM'),
        preferredAppointment: optStr,
        location: optStr,
      }),
      fields,
    );
    const leases = await activeLeases(tenantId);
    const lease = input.leaseId ? leases.find((l) => l.id === input.leaseId) : leases[0];
    if (!lease) throw badRequest('Kein aktiver Mietvertrag gefunden.');
    if (files.some((f) => !f.mimetype.startsWith('image/') && !f.mimetype.startsWith('video/') && f.mimetype !== 'application/pdf'))
      throw badRequest('Erlaubt sind Fotos, Videos und PDF.');
    const report = await createDamageReport(
      req,
      {
        propertyId: lease.unit.propertyId,
        unitId: lease.unitId,
        tenantId,
        category: input.category,
        title: input.title,
        description: input.description,
        priority: input.priority,
        preferredAppointment: input.preferredAppointment,
        location: input.location,
      },
      files,
    );
    return { id: report.id, ticketNumber: report.ticketNumber };
  });

  app.get('/damages/:id', async (req) => {
    const tenantId = tenantIdOf(req);
    const { id } = parse(idParam, req.params);
    const d = await prisma.damageReport.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        ticketNumber: true,
        title: true,
        description: true,
        category: true,
        priority: true,
        status: true,
        preferredAppointment: true,
        location: true,
        createdAt: true,
        resolvedAt: true,
        unit: { select: { label: true } },
        property: { select: { name: true } },
        events: { where: { isPublic: true }, orderBy: { createdAt: 'asc' }, select: { id: true, type: true, message: true, createdAt: true, user: { select: { firstName: true, lastName: true, role: true } } } },
        documents: { where: { deletedAt: null, visibleToTenant: true }, select: { id: true, name: true, mimeType: true, createdAt: true } },
        appointments: { where: { visibleToTenant: true }, select: { id: true, title: true, startAt: true, endAt: true } },
      },
    });
    if (!d) throw notFound('Meldung');
    return d;
  });

  app.post('/damages/:id/comments', async (req) => {
    const tenantId = tenantIdOf(req);
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ message: z.string().trim().min(1).max(5000) }), req.body);
    const d = await prisma.damageReport.findFirst({ where: { id, tenantId } });
    if (!d) throw notFound('Meldung');
    const ev = await addDamageEvent(id, req.user.id, 'COMMENT', body.message);
    await notifyStaff({
      organizationId: req.user.organizationId,
      type: 'DAMAGE_UPDATE',
      title: `Rückmeldung zu Ticket #${d.ticketNumber}`,
      body: body.message.slice(0, 140),
      link: `/maengel/${id}`,
      propertyId: d.propertyId,
      roles: ['OWNER', 'MANAGER', 'EMPLOYEE', 'CARETAKER'],
    });
    return ev;
  });

  // ───── Nachrichten ─────
  app.get('/conversations', async (req) => listConversations(req.user));
  app.get('/conversations/:id', async (req) => getConversation(req.user, parse(idParam, req.params).id));
  app.post('/conversations', async (req) => {
    const tenantId = tenantIdOf(req);
    const body = parse(z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(10000) }), req.body);
    const leases = await activeLeases(tenantId);
    // Empfänger: Verwaltung (Verwalter/Eigentümer) der Organisation
    const managers = await prisma.user.findMany({ where: { organizationId: req.user.organizationId, isActive: true, role: { in: ['MANAGER', 'OWNER'] } }, select: { id: true } });
    if (!managers.length) throw badRequest('Keine Verwaltung erreichbar.');
    return createConversation(req.user, {
      subject: body.subject,
      body: body.body,
      participantIds: managers.map((m) => m.id),
      tenantId,
      propertyId: leases[0]?.unit.propertyId ?? null,
      unitId: leases[0]?.unitId ?? null,
    });
  });
  app.post('/conversations/:id/messages', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ body: z.string().trim().min(1).max(10000) }), req.body);
    return sendMessage(req.user, id, body.body);
  });

  // ───── Termine, Mitteilungen, Immobilie ─────
  app.get('/appointments', async (req) => {
    const tenantId = tenantIdOf(req);
    return prisma.appointment.findMany({
      where: { tenantId, visibleToTenant: true, startAt: { gte: new Date(Date.now() - 30 * 86400000) } },
      select: { id: true, title: true, description: true, startAt: true, endAt: true, location: true, damageReport: { select: { ticketNumber: true, title: true } } },
      orderBy: { startAt: 'asc' },
    });
  });

  app.get('/announcements', async (req) => {
    const tenantId = tenantIdOf(req);
    const leases = await activeLeases(tenantId);
    return prisma.announcement.findMany({
      where: { organizationId: req.user.organizationId, OR: [{ propertyId: null }, { propertyId: { in: leases.map((l) => l.unit.propertyId) } }] },
      select: { id: true, title: true, body: true, important: true, publishedAt: true, property: { select: { name: true } } },
      orderBy: [{ publishedAt: 'desc' }],
    });
  });

  app.get('/property', async (req) => {
    const tenantId = tenantIdOf(req);
    const leases = await activeLeases(tenantId);
    const result = [];
    for (const l of leases) {
      const caretakers = await prisma.user.findMany({
        where: { role: 'CARETAKER', isActive: true, propertyAccess: { some: { propertyId: l.unit.propertyId } } },
        select: { firstName: true, lastName: true, phone: true, email: true },
      });
      result.push({
        property: { name: l.unit.property.name, street: l.unit.property.street, zip: l.unit.property.zip, city: l.unit.property.city, yearBuilt: l.unit.property.yearBuilt, tenantInfo: l.unit.property.tenantInfo },
        unit: { label: l.unit.label, floor: l.unit.floor, rooms: l.unit.rooms, areaM2: l.unit.areaM2, type: l.unit.type },
        caretakers,
      });
    }
    return result;
  });
}
