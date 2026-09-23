import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { idParam, optStr, parse } from '../lib/http.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { can, propertyIdFilter, requirePermission, type AuthUser } from '../auth/context.js';
import { auditReq, diff } from '../services/audit.js';
import { tenantAccount } from '../services/payments.js';
import { hashPassword } from '../auth/password.js';
import { generateInitialPassword } from './users.js';

const tenantSchema = z.object({
  isCompany: z.boolean().default(false),
  firstName: optStr,
  lastName: optStr,
  companyName: optStr,
  email: z.string().trim().email().nullish().or(z.literal('').transform(() => null)),
  phone: optStr,
  street: optStr,
  zip: optStr,
  city: optStr,
  iban: optStr.transform((v) => (v ? v.replace(/\s/g, '').toUpperCase() : v)),
  dateOfBirth: z.coerce.date().nullish(),
  notes: optStr,
});

/** Mieter sind über ihre Mietverträge an Immobilien gebunden – Scope entsprechend prüfen. */
export function tenantScopeWhere(user: AuthUser) {
  const f = propertyIdFilter(user);
  return {
    organizationId: user.organizationId,
    ...(f ? { leases: { some: { unit: { propertyId: f } } } } : {}),
  };
}

export async function tenantRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePermission('tenant:read') }, async (req) => {
    const q = parse(z.object({ search: z.string().optional(), status: z.enum(['active', 'former', 'all']).default('active') }), req.query);
    const s = q.search?.trim();
    const tenants = await prisma.tenant.findMany({
      where: {
        AND: [tenantScopeWhere(req.user)],
        archivedAt: null,
        ...(s
          ? {
              OR: [
                { lastName: { contains: s, mode: 'insensitive' } },
                { firstName: { contains: s, mode: 'insensitive' } },
                { companyName: { contains: s, mode: 'insensitive' } },
                { email: { contains: s, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(q.status === 'active' ? { leases: { some: { status: { in: ['ACTIVE', 'TERMINATED'] } } } } : q.status === 'former' ? { leases: { none: { status: { in: ['ACTIVE', 'TERMINATED'] } } } } : {}),
      },
      include: {
        leases: {
          where: { status: { in: ['ACTIVE', 'TERMINATED', 'DRAFT'] } },
          include: { unit: { include: { property: { select: { id: true, name: true } } } }, charges: { where: { status: { in: ['OVERDUE', 'PARTIAL'] } }, select: { amountCents: true, paidCents: true } } },
        },
        user: { select: { id: true, isActive: true, lastLoginAt: true } },
      },
      orderBy: [{ lastName: 'asc' }, { companyName: 'asc' }],
    });
    const fin = can(req.user, 'finance:read');
    return tenants.map((t) => ({
      id: t.id,
      isCompany: t.isCompany,
      firstName: t.firstName,
      lastName: t.lastName,
      companyName: t.companyName,
      email: t.email,
      phone: t.phone,
      portalAccess: !!t.user?.isActive,
      leases: t.leases.map((l) => ({
        id: l.id,
        status: l.status,
        unit: { id: l.unit.id, label: l.unit.label },
        property: l.unit.property,
        monthlyCents: fin ? l.netRentCents + l.utilitiesCents : undefined,
      })),
      openCents: fin ? t.leases.flatMap((l) => l.charges).reduce((s, c) => s + c.amountCents - c.paidCents, 0) : undefined,
    }));
  });

  app.post('/', { preHandler: requirePermission('tenant:write') }, async (req) => {
    const body = parse(tenantSchema, req.body);
    if (!body.lastName && !body.companyName) throw badRequest('Nachname oder Firmenname ist erforderlich.');
    const t = await prisma.tenant.create({ data: { ...body, organizationId: req.user.organizationId } });
    await auditReq(req, { action: 'tenant.create', entityType: 'Tenant', entityId: t.id, summary: `Mieter ${t.companyName ?? `${t.firstName ?? ''} ${t.lastName}`} angelegt`, newValues: body });
    return t;
  });

  app.get('/:id', { preHandler: requirePermission('tenant:read') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const t = await prisma.tenant.findFirst({
      where: { id, ...tenantScopeWhere(req.user) },
      include: {
        leases: { orderBy: { startDate: 'desc' }, include: { unit: { include: { property: { select: { id: true, name: true } } } } } },
        user: { select: { id: true, email: true, isActive: true, lastLoginAt: true } },
        damageReports: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, ticketNumber: true, title: true, status: true, priority: true, createdAt: true } },
        documents: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
        payerAliases: can(req.user, 'finance:read') ? { select: { id: true, normalizedName: true, iban: true, timesConfirmed: true } } : false,
      },
    });
    if (!t) throw notFound('Mieter');
    if (!can(req.user, 'finance:read')) {
      t.iban = null;
      t.leases = t.leases.map((l) => ({ ...l, netRentCents: 0, utilitiesCents: 0, depositCents: 0 }));
    }
    return t;
  });

  app.get('/:id/account', { preHandler: requirePermission('tenant:read', 'finance:read') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const t = await prisma.tenant.findFirst({ where: { id, ...tenantScopeWhere(req.user) }, select: { id: true } });
    if (!t) throw notFound('Mieter');
    return tenantAccount(id, req.user.organizationId);
  });

  app.patch('/:id', { preHandler: requirePermission('tenant:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const before = await prisma.tenant.findFirst({ where: { id, ...tenantScopeWhere(req.user) } });
    if (!before) throw notFound('Mieter');
    const body = parse(tenantSchema.partial(), req.body);
    const t = await prisma.tenant.update({ where: { id }, data: body });
    const d = diff(before as unknown as Record<string, unknown>, body);
    if (d.changed) await auditReq(req, { action: 'tenant.update', entityType: 'Tenant', entityId: id, summary: `Mieter ${t.lastName ?? t.companyName} geändert`, ...d });
    return t;
  });

  /** Mieter-App-Zugang erstellen */
  app.post('/:id/portal-access', { preHandler: requirePermission('tenant:write', 'user:manage') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const t = await prisma.tenant.findFirst({ where: { id, organizationId: req.user.organizationId }, include: { user: true } });
    if (!t) throw notFound('Mieter');
    if (t.user) throw conflict('Der Mieter hat bereits einen Zugang.');
    const body = parse(z.object({ email: z.string().email().optional() }), req.body ?? {});
    const email = (body.email ?? t.email)?.toLowerCase();
    if (!email) throw badRequest('Für den Zugang ist eine E-Mail-Adresse erforderlich.');
    const password = generateInitialPassword();
    const user = await prisma.user.create({
      data: {
        organizationId: req.user.organizationId,
        email,
        firstName: t.firstName ?? t.companyName ?? '',
        lastName: t.lastName ?? '',
        role: 'TENANT',
        tenantId: t.id,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
      },
    });
    await auditReq(req, { action: 'tenant.portal_access', entityType: 'Tenant', entityId: id, summary: `Mieter-App-Zugang für ${email} erstellt`, newValues: { userId: user.id } });
    return { email, initialPassword: password };
  });
}
