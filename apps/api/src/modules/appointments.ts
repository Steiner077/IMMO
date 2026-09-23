import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { formatDateTime } from '@immo/shared';
import { prisma } from '../lib/prisma.js';
import { idParam, optStr, parse } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { propertyIdFilter, requirePermission, type AuthUser } from '../auth/context.js';
import { auditReq } from '../services/audit.js';
import { notifyUsers } from '../services/notifications.js';
import { addDamageEvent } from './damages.js';

const schema = z.object({
  title: z.string().trim().min(1).max(200),
  description: optStr,
  startAt: z.coerce.date(),
  endAt: z.coerce.date().nullish(),
  location: optStr,
  propertyId: optStr,
  unitId: optStr,
  tenantId: optStr,
  damageReportId: optStr,
  visibleToTenant: z.boolean().default(false),
});

function scope(user: AuthUser): Prisma.AppointmentWhereInput {
  const pf = propertyIdFilter(user);
  return { organizationId: user.organizationId, ...(pf ? { OR: [{ propertyId: pf }, { createdById: user.id }] } : {}) };
}

/** iCalendar-Export für die Anbindung an externe Kalender */
function toIcs(items: { id: string; title: string; description: string | null; startAt: Date; endAt: Date | null; location: string | null }[]) {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/[,;\\]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//IMMO//Plattform//DE',
    ...items.flatMap((a) => [
      'BEGIN:VEVENT',
      `UID:${a.id}@immo`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(a.startAt)}`,
      `DTEND:${fmt(a.endAt ?? new Date(a.startAt.getTime() + 3600000))}`,
      `SUMMARY:${esc(a.title)}`,
      ...(a.location ? [`LOCATION:${esc(a.location)}`] : []),
      ...(a.description ? [`DESCRIPTION:${esc(a.description)}`] : []),
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ].join('\r\n');
}

export async function appointmentRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePermission('appointment:read') }, async (req) => {
    const q = parse(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query);
    return prisma.appointment.findMany({
      where: { ...scope(req.user), startAt: { gte: q.from ?? new Date(Date.now() - 30 * 86400000), lte: q.to } },
      include: {
        property: { select: { id: true, name: true } },
        unit: { select: { id: true, label: true } },
        tenant: { select: { id: true, firstName: true, lastName: true, companyName: true } },
        damageReport: { select: { id: true, ticketNumber: true, title: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startAt: 'asc' },
    });
  });

  app.get('/calendar.ics', { preHandler: requirePermission('appointment:read') }, async (req, reply) => {
    const items = await prisma.appointment.findMany({ where: { ...scope(req.user), startAt: { gte: new Date(Date.now() - 90 * 86400000) } } });
    reply.header('Content-Type', 'text/calendar; charset=utf-8').header('Content-Disposition', 'attachment; filename="immo-termine.ics"');
    return toIcs(items);
  });

  app.post('/', { preHandler: requirePermission('appointment:write') }, async (req) => {
    const body = parse(schema, req.body);
    const a = await prisma.appointment.create({ data: { ...body, organizationId: req.user.organizationId, createdById: req.user.id } });
    await auditReq(req, { action: 'appointment.create', entityType: 'Appointment', entityId: a.id, summary: `Termin "${a.title}" am ${formatDateTime(a.startAt)}` });
    if (a.damageReportId) await addDamageEvent(a.damageReportId, req.user.id, 'APPOINTMENT', `Termin vereinbart: ${formatDateTime(a.startAt)}`, { appointmentId: a.id }, a.visibleToTenant);
    if (a.visibleToTenant && a.tenantId) {
      const t = await prisma.tenant.findUnique({ where: { id: a.tenantId }, include: { user: true } });
      if (t?.user) await notifyUsers([t.user.id], { organizationId: req.user.organizationId, type: 'APPOINTMENT_REMINDER', title: `Neuer Termin: ${a.title}`, body: formatDateTime(a.startAt), link: '/termine' });
    }
    return a;
  });

  app.patch('/:id', { preHandler: requirePermission('appointment:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(schema.partial(), req.body);
    const before = await prisma.appointment.findFirst({ where: { id, ...scope(req.user) } });
    if (!before) throw notFound('Termin');
    const a = await prisma.appointment.update({ where: { id }, data: { ...body, reminderSentAt: body.startAt ? null : undefined } });
    await auditReq(req, { action: 'appointment.update', entityType: 'Appointment', entityId: id, summary: `Termin "${a.title}" geändert`, oldValues: { startAt: before.startAt }, newValues: body });
    return a;
  });

  app.delete('/:id', { preHandler: requirePermission('appointment:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const a = await prisma.appointment.findFirst({ where: { id, ...scope(req.user) } });
    if (!a) throw notFound('Termin');
    await prisma.appointment.delete({ where: { id } });
    await auditReq(req, { action: 'appointment.delete', entityType: 'Appointment', entityId: id, summary: `Termin "${a.title}" gelöscht` });
    return { ok: true };
  });
}
