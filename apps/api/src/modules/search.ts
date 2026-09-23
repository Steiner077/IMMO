import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { parse } from '../lib/http.js';
import { can, propertyIdFilter } from '../auth/context.js';
import { tenantScopeWhere } from './tenants.js';
import { damageScope } from './damages.js';
import { documentScope } from './documents.js';
import { conversationScope } from '../services/messages.js';

/** Globale Suche über alle Bereiche – streng nach Berechtigungen gefiltert. */
export async function searchRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(100) }), req.query);
    const u = req.user;
    const ci = { contains: q, mode: 'insensitive' as const };
    const pf = propertyIdFilter(u);
    const take = 8;
    const empty = Promise.resolve([] as never[]);

    const [tenants, units, properties, payments, documents, tickets, messages] = await Promise.all([
      can(u, 'tenant:read')
        ? prisma.tenant.findMany({
            where: { ...tenantScopeWhere(u), OR: [{ lastName: ci }, { firstName: ci }, { companyName: ci }, { email: ci }, { phone: ci }] },
            select: { id: true, firstName: true, lastName: true, companyName: true, leases: { where: { status: { in: ['ACTIVE', 'TERMINATED'] } }, select: { unit: { select: { label: true, property: { select: { name: true } } } } } } },
            take,
          })
        : empty,
      can(u, 'unit:read')
        ? prisma.unit.findMany({
            where: {
              archivedAt: null,
              property: { organizationId: u.organizationId, id: pf },
              OR: [{ label: ci }, { leases: { some: { status: { in: ['ACTIVE', 'TERMINATED'] }, tenant: { OR: [{ lastName: ci }, { companyName: ci }] } } } }],
            },
            select: { id: true, label: true, property: { select: { name: true } } },
            take,
          })
        : empty,
      can(u, 'property:read')
        ? prisma.property.findMany({ where: { organizationId: u.organizationId, id: pf, OR: [{ name: ci }, { street: ci }, { city: ci }] }, select: { id: true, name: true, street: true, city: true }, take })
        : empty,
      can(u, 'finance:read')
        ? prisma.payment.findMany({
            where: {
              organizationId: u.organizationId,
              ...(pf ? { propertyId: pf } : {}),
              OR: [{ payerName: ci }, { reference: ci }, { tenant: { OR: [{ lastName: ci }, { companyName: ci }] } }, ...(Number.isInteger(+q) ? [{ number: +q }] : [])],
            },
            select: { id: true, number: true, bookingDate: true, amountCents: true, payerName: true, status: true },
            orderBy: { bookingDate: 'desc' },
            take,
          })
        : empty,
      can(u, 'document:read')
        ? prisma.document.findMany({ where: { ...documentScope(u), OR: [{ name: ci }, { description: ci }, { tenant: { lastName: ci } }] }, select: { id: true, name: true, category: true, createdAt: true }, take })
        : empty,
      can(u, 'damage:read')
        ? prisma.damageReport.findMany({
            where: { ...damageScope(u), OR: [{ title: ci }, { description: ci }, { tenant: { lastName: ci } }, ...(Number.isInteger(+q.replace('#', '')) ? [{ ticketNumber: +q.replace('#', '') }] : [])] },
            select: { id: true, ticketNumber: true, title: true, status: true },
            take,
          })
        : empty,
      can(u, 'message:read')
        ? prisma.message.findMany({
            where: { conversation: conversationScope(u), OR: [{ body: ci }, { conversation: { subject: ci } }, { sender: { lastName: ci } }] },
            select: { id: true, body: true, createdAt: true, conversation: { select: { id: true, subject: true } } },
            orderBy: { createdAt: 'desc' },
            take,
          })
        : empty,
    ]);
    return { tenants, units, properties, payments, documents, tickets, messages };
  });
}
