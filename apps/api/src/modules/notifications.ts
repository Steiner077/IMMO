import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { idParam, parse } from '../lib/http.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const q = parse(z.object({ unread: z.coerce.boolean().optional(), type: z.string().optional() }), req.query);
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user.id, ...(q.unread ? { readAt: null } : {}), ...(q.type ? { type: q.type } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.notification.count({ where: { userId: req.user.id, readAt: null } }),
    ]);
    return { items, unread };
  });

  app.get('/unread-count', async (req) => ({ unread: await prisma.notification.count({ where: { userId: req.user.id, readAt: null } }) }));

  app.post('/:id/read', async (req) => {
    const { id } = parse(idParam, req.params);
    await prisma.notification.updateMany({ where: { id, userId: req.user.id }, data: { readAt: new Date() } });
    return { ok: true };
  });

  app.post('/read-all', async (req) => {
    await prisma.notification.updateMany({ where: { userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  });
}
