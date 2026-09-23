import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { idParam, optStr, parse } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { propertyIdFilter, requirePermission, scopedPropertyId, type AuthUser } from '../auth/context.js';
import { auditReq } from '../services/audit.js';
import { notifyUsers } from '../services/notifications.js';

const taskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: optStr,
  status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']).default('OPEN'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  dueDate: z.coerce.date().nullish(),
  assigneeId: optStr,
  propertyId: optStr,
  unitId: optStr,
  tenantId: optStr,
  damageReportId: optStr,
});

function taskScope(user: AuthUser): Prisma.TaskWhereInput {
  const pf = propertyIdFilter(user);
  return {
    organizationId: user.organizationId,
    ...(pf ? { OR: [{ assigneeId: user.id }, { createdById: user.id }, { propertyId: pf }] } : {}),
  };
}

export async function taskRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePermission('task:read') }, async (req) => {
    const q = parse(z.object({ status: z.string().optional(), mine: z.coerce.boolean().optional(), propertyId: z.string().optional() }), req.query);
    return prisma.task.findMany({
      where: {
        ...taskScope(req.user),
        ...(q.status ? { status: { in: q.status.split(',') as never } } : {}),
        ...(q.mine ? { assigneeId: req.user.id } : {}),
        ...(q.propertyId ? { propertyId: scopedPropertyId(req.user, q.propertyId) } : {}),
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true } },
        property: { select: { id: true, name: true } },
        unit: { select: { id: true, label: true } },
        damageReport: { select: { id: true, ticketNumber: true } },
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    });
  });

  app.post('/', { preHandler: requirePermission('task:write') }, async (req) => {
    const body = parse(taskSchema, req.body);
    const t = await prisma.task.create({ data: { ...body, organizationId: req.user.organizationId, createdById: req.user.id } });
    await auditReq(req, { action: 'task.create', entityType: 'Task', entityId: t.id, summary: `Aufgabe "${t.title}" erstellt` });
    if (t.assigneeId && t.assigneeId !== req.user.id)
      await notifyUsers([t.assigneeId], { organizationId: req.user.organizationId, type: 'TASK_ASSIGNED', title: `Neue Aufgabe: ${t.title}`, link: '/aufgaben', entityType: 'Task', entityId: t.id });
    return t;
  });

  app.patch('/:id', { preHandler: requirePermission('task:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(taskSchema.partial(), req.body);
    const before = await prisma.task.findFirst({ where: { id, ...taskScope(req.user) } });
    if (!before) throw notFound('Aufgabe');
    const t = await prisma.task.update({
      where: { id },
      data: { ...body, completedAt: body.status === 'DONE' ? new Date() : body.status ? null : undefined },
    });
    await auditReq(req, { action: 'task.update', entityType: 'Task', entityId: id, summary: `Aufgabe "${t.title}" geändert`, oldValues: { status: before.status, assigneeId: before.assigneeId }, newValues: body });
    if (body.assigneeId && body.assigneeId !== before.assigneeId && body.assigneeId !== req.user.id)
      await notifyUsers([body.assigneeId], { organizationId: req.user.organizationId, type: 'TASK_ASSIGNED', title: `Aufgabe zugewiesen: ${t.title}`, link: '/aufgaben', entityType: 'Task', entityId: t.id });
    return t;
  });

  app.delete('/:id', { preHandler: requirePermission('task:write') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const t = await prisma.task.findFirst({ where: { id, ...taskScope(req.user) } });
    if (!t) throw notFound('Aufgabe');
    await prisma.task.delete({ where: { id } });
    await auditReq(req, { action: 'task.delete', entityType: 'Task', entityId: id, summary: `Aufgabe "${t.title}" gelöscht` });
    return { ok: true };
  });
}
