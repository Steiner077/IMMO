import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { Prisma } from '@prisma/client';
import { config } from './config.js';
import { AppError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { authenticate } from './auth/context.js';
import { authRoutes } from './modules/auth.js';
import { userRoutes } from './modules/users.js';
import { propertyRoutes } from './modules/properties.js';
import { tenantRoutes } from './modules/tenants.js';
import { leaseRoutes } from './modules/leases.js';
import { paymentRoutes } from './modules/payments.js';
import { importRoutes } from './modules/imports.js';
import { monthlyRoutes } from './modules/monthly.js';
import { dashboardRoutes } from './modules/dashboard.js';
import { damageRoutes } from './modules/damages.js';
import { documentRoutes } from './modules/documents.js';
import { messageRoutes } from './modules/messages.js';
import { taskRoutes } from './modules/tasks.js';
import { appointmentRoutes } from './modules/appointments.js';
import { notificationRoutes } from './modules/notifications.js';
import { financeRoutes } from './modules/finance.js';
import { providerRoutes } from './modules/providers.js';
import { auditRoutes } from './modules/audit.js';
import { searchRoutes } from './modules/search.js';
import { excelRoutes } from './modules/excel.js';
import { automationRoutes } from './modules/automation.js';
import { settingsRoutes } from './modules/settings.js';
import { announcementRoutes } from './modules/announcements.js';
import { portalRoutes } from './modules/portal.js';

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } });
  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 10 } });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });

  app.setErrorHandler((err: FastifyError | AppError | Error, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return reply.status(409).send({ error: 'CONFLICT', message: 'Eintrag existiert bereits (Eindeutigkeit verletzt).' });
      if (err.code === 'P2025') return reply.status(404).send({ error: 'NOT_FOUND', message: 'Eintrag nicht gefunden.' });
      if (err.code === 'P2003') return reply.status(409).send({ error: 'CONFLICT', message: 'Eintrag wird noch verwendet oder Verknüpfung ungültig.' });
    }
    const fe = err as FastifyError;
    if (fe.statusCode && fe.statusCode < 500) {
      const code = fe.statusCode === 429 ? 'RATE_LIMITED' : fe.statusCode === 413 ? 'FILE_TOO_LARGE' : (fe.code ?? 'BAD_REQUEST');
      const message = fe.statusCode === 429 ? 'Zu viele Anfragen. Bitte warten Sie einen Moment.' : fe.message;
      return reply.status(fe.statusCode).send({ error: code, message });
    }
    req.log.error({ err }, 'Unerwarteter Fehler');
    return reply.status(500).send({ error: 'INTERNAL', message: 'Interner Fehler. Der Vorfall wurde protokolliert.', requestId: req.id });
  });

  app.get('/api/health', async () => ({ status: 'ok', time: new Date().toISOString() }));

  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      // Alle weiteren Routen erfordern eine Anmeldung
      await api.register(async (secured) => {
        secured.addHook('onRequest', authenticate);
        await secured.register(userRoutes, { prefix: '/users' });
        await secured.register(propertyRoutes);
        await secured.register(tenantRoutes, { prefix: '/tenants' });
        await secured.register(leaseRoutes);
        await secured.register(paymentRoutes, { prefix: '/payments' });
        await secured.register(importRoutes, { prefix: '/imports' });
        await secured.register(monthlyRoutes, { prefix: '/monthly' });
        await secured.register(dashboardRoutes, { prefix: '/dashboard' });
        await secured.register(damageRoutes, { prefix: '/damages' });
        await secured.register(documentRoutes, { prefix: '/documents' });
        await secured.register(messageRoutes, { prefix: '/conversations' });
        await secured.register(taskRoutes, { prefix: '/tasks' });
        await secured.register(appointmentRoutes, { prefix: '/appointments' });
        await secured.register(notificationRoutes, { prefix: '/notifications' });
        await secured.register(financeRoutes);
        await secured.register(providerRoutes, { prefix: '/providers' });
        await secured.register(auditRoutes, { prefix: '/audit' });
        await secured.register(searchRoutes, { prefix: '/search' });
        await secured.register(excelRoutes, { prefix: '/excel' });
        await secured.register(automationRoutes, { prefix: '/automation' });
        await secured.register(settingsRoutes, { prefix: '/settings' });
        await secured.register(announcementRoutes, { prefix: '/announcements' });
        await secured.register(portalRoutes, { prefix: '/portal' });
      });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
