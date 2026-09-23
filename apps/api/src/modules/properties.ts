import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { toPeriod } from '@immo/shared';
import { prisma } from '../lib/prisma.js';
import { idParam, optStr, parse } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { assertPropertyAccess, can, propertyIdFilter, requirePermission } from '../auth/context.js';
import { auditReq, diff } from '../services/audit.js';

const propertySchema = z.object({
  name: z.string().trim().min(1).max(200),
  street: z.string().trim().min(1),
  zip: z.string().trim().min(1).max(10),
  city: z.string().trim().min(1),
  country: z.string().trim().length(2).default('CH'),
  type: z.enum(['RESIDENTIAL', 'COMMERCIAL', 'MIXED', 'OTHER']).default('RESIDENTIAL'),
  yearBuilt: z.coerce.number().int().min(1500).max(2100).nullish(),
  purchasePriceCents: z.coerce.number().int().nullish(),
  description: optStr,
  tenantInfo: optStr,
});

const unitSchema = z.object({
  label: z.string().trim().min(1).max(50),
  type: z.enum(['APARTMENT', 'HOUSE', 'COMMERCIAL', 'OFFICE', 'PARKING', 'GARAGE', 'STORAGE', 'OTHER']).default('APARTMENT'),
  floor: optStr,
  rooms: z.coerce.number().min(0).max(100).nullish(),
  areaM2: z.coerce.number().min(0).max(100000).nullish(),
  targetRentCents: z.coerce.number().int().nullish(),
  description: optStr,
});

const PARKING_TYPES = new Set(['PARKING', 'GARAGE']);

export async function propertyRoutes(app: FastifyInstance) {
  app.get('/properties', { preHandler: requirePermission('property:read') }, async (req) => {
    const q = parse(z.object({ archived: z.coerce.boolean().default(false) }), req.query);
    const period = toPeriod(new Date());
    const properties = await prisma.property.findMany({
      where: { organizationId: req.user.organizationId, id: propertyIdFilter(req.user), archivedAt: q.archived ? { not: null } : null },
      include: {
        units: {
          where: { archivedAt: null },
          select: { type: true, leases: { where: { status: { in: ['ACTIVE', 'TERMINATED'] } }, select: { id: true, netRentCents: true, utilitiesCents: true } } },
        },
        _count: { select: { damageReports: { where: { status: { in: ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'WAITING'] } } } } },
      },
      orderBy: { name: 'asc' },
    });
    const showFinance = can(req.user, 'finance:read');
    const charges = showFinance
      ? await prisma.rentCharge.groupBy({
          by: ['leaseId'],
          where: { period, lease: { unit: { property: { organizationId: req.user.organizationId } } } },
          _sum: { amountCents: true, paidCents: true },
        })
      : [];
    return properties.map((p) => {
      const leaseIds = p.units.flatMap((u) => u.leases.map((l) => l.id));
      const monthly = charges.filter((c) => leaseIds.includes(c.leaseId));
      return {
        id: p.id,
        name: p.name,
        street: p.street,
        zip: p.zip,
        city: p.city,
        type: p.type,
        yearBuilt: p.yearBuilt,
        unitCount: p.units.length,
        occupiedCount: p.units.filter((u) => u.leases.length > 0).length,
        parkingCount: p.units.filter((u) => PARKING_TYPES.has(u.type)).length,
        parkingOccupiedCount: p.units.filter((u) => PARKING_TYPES.has(u.type) && u.leases.length > 0).length,
        openDamages: p._count.damageReports,
        ...(showFinance
          ? {
              monthlyRentCents: p.units.reduce((s, u) => s + u.leases.reduce((a, l) => a + l.netRentCents + l.utilitiesCents, 0), 0),
              currentPeriod: period,
              currentDueCents: monthly.reduce((s, c) => s + (c._sum.amountCents ?? 0), 0),
              currentPaidCents: monthly.reduce((s, c) => s + (c._sum.paidCents ?? 0), 0),
            }
          : {}),
      };
    });
  });

  app.post('/properties', { preHandler: requirePermission('property:write') }, async (req) => {
    const body = parse(propertySchema, req.body);
    const p = await prisma.property.create({ data: { ...body, organizationId: req.user.organizationId } });
    await auditReq(req, { action: 'property.create', entityType: 'Property', entityId: p.id, summary: `Immobilie ${p.name} angelegt`, newValues: body });
    return p;
  });

  app.get('/properties/:id', { preHandler: requirePermission('property:read') }, async (req) => {
    const { id } = parse(idParam, req.params);
    assertPropertyAccess(req.user, id);
    const showFinance = can(req.user, 'finance:read');
    const p = await prisma.property.findFirst({
      where: { id, organizationId: req.user.organizationId },
      include: {
        units: {
          where: { archivedAt: null },
          orderBy: { label: 'asc' },
          include: {
            leases: {
              where: { status: { in: ['ACTIVE', 'TERMINATED'] } },
              include: { tenant: { select: { id: true, firstName: true, lastName: true, companyName: true, phone: true, email: true } } },
            },
          },
        },
      },
    });
    if (!p) throw notFound('Immobilie');
    if (!showFinance) {
      p.purchasePriceCents = null;
      for (const u of p.units) {
        u.targetRentCents = null;
        for (const l of u.leases) {
          l.netRentCents = 0;
          l.utilitiesCents = 0;
          l.depositCents = 0;
        }
      }
    }
    return p;
  });

  app.patch('/properties/:id', { preHandler: requirePermission('property:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    assertPropertyAccess(req.user, id);
    const body = parse(propertySchema.partial(), req.body);
    const before = await prisma.property.findFirst({ where: { id, organizationId: req.user.organizationId } });
    if (!before) throw notFound('Immobilie');
    const p = await prisma.property.update({ where: { id }, data: body });
    const d = diff(before as unknown as Record<string, unknown>, body);
    if (d.changed) await auditReq(req, { action: 'property.update', entityType: 'Property', entityId: id, summary: `Immobilie ${p.name} geändert`, ...d });
    return p;
  });

  app.post('/properties/:id/archive', { preHandler: requirePermission('property:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const p = await prisma.property.findFirst({ where: { id, organizationId: req.user.organizationId } });
    if (!p) throw notFound('Immobilie');
    await prisma.property.update({ where: { id }, data: { archivedAt: p.archivedAt ? null : new Date() } });
    await auditReq(req, { action: p.archivedAt ? 'property.restore' : 'property.archive', entityType: 'Property', entityId: id, summary: `Immobilie ${p.name} ${p.archivedAt ? 'reaktiviert' : 'archiviert'}` });
    return { ok: true };
  });

  // ───── Mietobjekte / Wohnungen ─────

  app.get('/units', { preHandler: requirePermission('unit:read') }, async (req) => {
    const q = parse(z.object({ propertyId: z.string().optional(), vacant: z.coerce.boolean().optional() }), req.query);
    if (q.propertyId) assertPropertyAccess(req.user, q.propertyId);
    const units = await prisma.unit.findMany({
      where: {
        archivedAt: null,
        propertyId: q.propertyId ?? propertyIdFilter(req.user),
        property: { organizationId: req.user.organizationId },
      },
      include: {
        property: { select: { id: true, name: true } },
        leases: { where: { status: { in: ['ACTIVE', 'TERMINATED'] } }, include: { tenant: { select: { id: true, firstName: true, lastName: true, companyName: true } } } },
      },
      orderBy: [{ property: { name: 'asc' } }, { label: 'asc' }],
    });
    return q.vacant ? units.filter((u) => u.leases.length === 0) : units;
  });

  app.post('/properties/:id/units', { preHandler: requirePermission('unit:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    assertPropertyAccess(req.user, id);
    const property = await prisma.property.findFirst({ where: { id, organizationId: req.user.organizationId } });
    if (!property) throw notFound('Immobilie');
    const body = parse(unitSchema, req.body);
    const u = await prisma.unit.create({ data: { ...body, propertyId: id } });
    await auditReq(req, { action: 'unit.create', entityType: 'Unit', entityId: u.id, summary: `Mietobjekt ${u.label} in ${property.name} angelegt`, newValues: body });
    return u;
  });

  // Mehrere gleichartige Objekte (z. B. Parkplätze PP1–PP20) in einem Schritt anlegen.
  app.post('/properties/:id/units/bulk', { preHandler: requirePermission('unit:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    assertPropertyAccess(req.user, id);
    const property = await prisma.property.findFirst({ where: { id, organizationId: req.user.organizationId } });
    if (!property) throw notFound('Immobilie');
    const body = parse(
      z.object({
        prefix: z.string().trim().max(20).default(''),
        from: z.coerce.number().int().min(0).max(9999),
        to: z.coerce.number().int().min(0).max(9999),
        type: z.enum(['PARKING', 'GARAGE', 'STORAGE', 'APARTMENT', 'OTHER']),
        floor: optStr,
        targetRentCents: z.coerce.number().int().nullish(),
      }).refine((b) => b.to >= b.from && b.to - b.from < 200, { message: 'Bereich ungültig (max. 200 Objekte)' }),
      req.body,
    );
    const labels = Array.from({ length: body.to - body.from + 1 }, (_, i) => `${body.prefix}${body.from + i}`);
    const existing = await prisma.unit.findMany({ where: { propertyId: id, label: { in: labels }, archivedAt: null }, select: { label: true } });
    const skip = new Set(existing.map((e) => e.label));
    const toCreate = labels.filter((l) => !skip.has(l));
    await prisma.unit.createMany({
      data: toCreate.map((label) => ({ propertyId: id, label, type: body.type, floor: body.floor ?? null, targetRentCents: body.targetRentCents ?? null })),
    });
    await auditReq(req, {
      action: 'unit.bulk_create',
      entityType: 'Property',
      entityId: id,
      summary: `${toCreate.length} Mietobjekte (${labels[0]}–${labels[labels.length - 1]}) in ${property.name} angelegt`,
      newValues: { ...body, created: toCreate },
    });
    return { created: toCreate.length, skipped: [...skip] };
  });

  app.get('/units/:id', { preHandler: requirePermission('unit:read') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const showFinance = can(req.user, 'finance:read');
    const u = await prisma.unit.findFirst({
      where: { id, property: { organizationId: req.user.organizationId } },
      include: {
        property: true,
        leases: { orderBy: { startDate: 'desc' }, include: { tenant: true } },
        damageReports: { orderBy: { createdAt: 'desc' }, take: 20 },
        documents: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!u) throw notFound('Mietobjekt');
    assertPropertyAccess(req.user, u.propertyId);
    if (!showFinance) {
      u.targetRentCents = null;
      u.leases = u.leases.map((l) => ({ ...l, netRentCents: 0, utilitiesCents: 0, depositCents: 0, tenant: { ...l.tenant, iban: null } }));
      u.documents = u.documents.filter((d) => !['INVOICE', 'BANK_STATEMENT', 'RECEIPT', 'EXPORT', 'LEASE', 'INSURANCE'].includes(d.category));
    }
    return u;
  });

  app.patch('/units/:id', { preHandler: requirePermission('unit:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const before = await prisma.unit.findFirst({ where: { id, property: { organizationId: req.user.organizationId } } });
    if (!before) throw notFound('Mietobjekt');
    assertPropertyAccess(req.user, before.propertyId);
    const body = parse(unitSchema.partial(), req.body);
    const u = await prisma.unit.update({ where: { id }, data: body });
    const d = diff(before as unknown as Record<string, unknown>, body);
    if (d.changed) await auditReq(req, { action: 'unit.update', entityType: 'Unit', entityId: id, summary: `Mietobjekt ${u.label} geändert`, ...d });
    return u;
  });
}
