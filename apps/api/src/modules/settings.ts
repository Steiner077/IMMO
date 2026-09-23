import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { parse } from '../lib/http.js';
import { requirePermission } from '../auth/context.js';
import { getOrgSettings, orgSettingsSchema } from '../services/settings.js';
import { auditReq } from '../services/audit.js';

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.user.organizationId } });
    return { organization: { id: org.id, name: org.name, currency: org.currency }, settings: await getOrgSettings(org.id) };
  });

  app.patch('/', { preHandler: requirePermission('settings:manage') }, async (req) => {
    const body = parse(z.object({ name: z.string().min(1).optional(), settings: orgSettingsSchema.partial().optional() }), req.body);
    const before = await getOrgSettings(req.user.organizationId);
    const next = orgSettingsSchema.parse({ ...before, ...body.settings });
    await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: { ...(body.name ? { name: body.name } : {}), settings: next as unknown as Prisma.InputJsonValue },
    });
    await auditReq(req, { action: 'settings.update', entityType: 'Organization', entityId: req.user.organizationId, summary: 'Einstellungen geändert', oldValues: before, newValues: next });
    return { settings: next };
  });
}
