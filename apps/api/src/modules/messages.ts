import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParam, optStr, parse } from '../lib/http.js';
import { requirePermission } from '../auth/context.js';
import { prisma } from '../lib/prisma.js';
import { createConversation, getConversation, listConversations, sendMessage } from '../services/messages.js';
import { readMultipart } from '../lib/upload.js';
import { storeDocument } from '../services/documents.js';
import { notFound } from '../lib/errors.js';
import { conversationScope } from '../services/messages.js';

export async function messageRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePermission('message:read') }, async (req) => {
    const q = parse(z.object({ tenantId: z.string().optional(), propertyId: z.string().optional(), damageReportId: z.string().optional() }), req.query);
    return listConversations(req.user, {
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.propertyId ? { propertyId: q.propertyId } : {}),
      ...(q.damageReportId ? { damageReportId: q.damageReportId } : {}),
    });
  });

  /** Mögliche Empfänger (Mieter mit App-Zugang, Hauswarte, Dienstleister, Team) */
  app.get('/recipients', { preHandler: requirePermission('message:write') }, async (req) =>
    prisma.user.findMany({
      where: {
        organizationId: req.user.organizationId,
        isActive: true,
        id: { not: req.user.id },
        // Mitarbeitende mit Immobilien-Freigabe sehen nur Mieter dieser Immobilien
        ...(req.user.propertyIds
          ? { OR: [{ role: { not: 'TENANT' } }, { tenant: { leases: { some: { status: { in: ['ACTIVE', 'TERMINATED'] }, unit: { propertyId: { in: req.user.propertyIds } } } } } }] }
          : {}),
        ...(req.user.role === 'SERVICE_PROVIDER' ? { role: { in: ['OWNER', 'MANAGER', 'EMPLOYEE', 'CARETAKER'] } } : {}),
      },
      select: { id: true, firstName: true, lastName: true, role: true, tenantId: true, tenant: { select: { leases: { where: { status: { in: ['ACTIVE', 'TERMINATED'] } }, select: { unit: { select: { label: true, propertyId: true, property: { select: { name: true } } } } } } } } },
      orderBy: [{ role: 'asc' }, { lastName: 'asc' }],
    }),
  );

  app.post('/', { preHandler: requirePermission('message:write') }, async (req) => {
    const body = parse(
      z.object({
        subject: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(10000),
        participantIds: z.array(z.string()).min(1),
        propertyId: optStr,
        unitId: optStr,
        tenantId: optStr,
        damageReportId: optStr,
        documentId: optStr,
      }),
      req.body,
    );
    return createConversation(req.user, body);
  });

  app.get('/:id', { preHandler: requirePermission('message:read') }, async (req) => getConversation(req.user, parse(idParam, req.params).id));

  app.post('/:id/messages', { preHandler: requirePermission('message:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    if (req.isMultipart()) {
      const { fields, files } = await readMultipart(req);
      const msg = await sendMessage(req.user, id, fields.body?.trim() || '(Anhang)');
      const conv = await prisma.conversation.findFirst({ where: { id, ...conversationScope(req.user) } });
      if (!conv) throw notFound('Unterhaltung');
      for (const f of files)
        await storeDocument(prisma, req.user.organizationId, f, { messageId: msg.id, tenantId: conv.tenantId, propertyId: conv.propertyId, category: 'CORRESPONDENCE', visibleToTenant: true, uploadedById: req.user.id });
      return msg;
    }
    const body = parse(z.object({ body: z.string().trim().min(1).max(10000) }), req.body);
    return sendMessage(req.user, id, body.body);
  });
}
