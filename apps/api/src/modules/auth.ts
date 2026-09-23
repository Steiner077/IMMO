import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isStaff, type Role } from '@immo/shared';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { parse } from '../lib/http.js';
import { AppError, badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { dummyVerify, hashPassword, passwordPolicyError, verifyPassword } from '../auth/password.js';
import { generateRefreshToken, hashToken, signAccessToken } from '../auth/tokens.js';
import { authenticate, loadAuthUser } from '../auth/context.js';
import { audit } from '../services/audit.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

type AppKind = 'admin' | 'tenant';
const appKind = (req: FastifyRequest): AppKind => (req.headers['x-immo-app'] === 'tenant' ? 'tenant' : 'admin');
const cookieName = (k: AppKind) => `immo_rt_${k}`;

function setRefreshCookie(reply: FastifyReply, kind: AppKind, token: string) {
  reply.setCookie(cookieName(kind), token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86400,
  });
}

async function issueSession(req: FastifyRequest, reply: FastifyReply, userId: string) {
  const user = await loadAuthUser(userId);
  if (!user) throw unauthorized();
  const { token, hash } = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86400000),
      userAgent: req.headers['user-agent']?.slice(0, 300),
      ip: req.ip,
    },
  });
  setRefreshCookie(reply, appKind(req), token);
  const accessToken = signAccessToken({ sub: user.id, org: user.organizationId, role: user.role });
  return { accessToken, user: publicUser(user) };
}

export function publicUser(u: NonNullable<Awaited<ReturnType<typeof loadAuthUser>>>) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    organizationId: u.organizationId,
    tenantId: u.tenantId,
    permissions: u.permissions,
    propertyIds: u.propertyIds,
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/login',
    { config: { rateLimit: { max: config.LOGIN_RATE_LIMIT, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
      const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase().trim() } });
      const genericError = unauthorized('E-Mail oder Passwort ist falsch.');
      if (!user || !user.isActive) {
        // gleiche Laufzeit wie bei existierendem Benutzer (Timing-Angriffe)
        await dummyVerify(body.password);
        throw genericError;
      }
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        throw new AppError(423, 'Konto vorübergehend gesperrt. Bitte später erneut versuchen.', 'LOCKED');
      }
      const ok = await verifyPassword(body.password, user.passwordHash);
      if (!ok) {
        const failed = user.failedLoginCount + 1;
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: failed >= MAX_FAILED ? 0 : failed,
            lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
          },
        });
        await audit({ organizationId: user.organizationId, req }, { action: 'auth.login_failed', entityType: 'User', entityId: user.id, summary: `Fehlgeschlagene Anmeldung (${failed})` });
        throw genericError;
      }
      const kind = appKind(req);
      const role = user.role as Role;
      if (kind === 'tenant' && role !== 'TENANT') throw forbidden('Bitte melden Sie sich in der Verwaltungs-App an.');
      if (kind === 'admin' && !isStaff(role) && role !== 'SERVICE_PROVIDER') throw forbidden('Bitte verwenden Sie die Mieter-App.');
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
      await audit({ organizationId: user.organizationId, req, user: null }, { action: 'auth.login', entityType: 'User', entityId: user.id, summary: `Anmeldung ${user.email}` });
      const session = await issueSession(req, reply, user.id);
      return { ...session, mustChangePassword: user.mustChangePassword };
    },
  );

  /** Refresh-Token-Rotation mit Wiederverwendungserkennung */
  app.post('/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const kind = appKind(req);
    const token = req.cookies[cookieName(kind)];
    if (!token) throw unauthorized();
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!stored) throw unauthorized();
    if (stored.revokedAt) {
      // Wiederverwendung eines rotierten Tokens → alle Sitzungen des Benutzers beenden
      await prisma.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw unauthorized('Sitzung ungültig');
    }
    if (stored.expiresAt < new Date()) throw unauthorized('Sitzung abgelaufen');
    const session = await issueSession(req, reply, stored.userId);
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return session;
  });

  app.post('/logout', async (req, reply) => {
    const kind = appKind(req);
    const token = req.cookies[cookieName(kind)];
    if (token) await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } });
    reply.clearCookie(cookieName(kind), { path: '/api/v1/auth' });
    return { ok: true };
  });

  app.get('/me', { onRequest: authenticate }, async (req) => ({ user: publicUser(req.user) }));

  app.post('/change-password', { onRequest: authenticate }, async (req) => {
    const body = parse(z.object({ currentPassword: z.string(), newPassword: z.string().max(200) }), req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) throw badRequest('Das aktuelle Passwort ist falsch.');
    const policy = passwordPolicyError(body.newPassword);
    if (policy) throw badRequest(policy);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false } });
    await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit({ user: req.user, organizationId: user.organizationId, req }, { action: 'auth.password_changed', entityType: 'User', entityId: user.id, summary: 'Passwort geändert' });
    return { ok: true };
  });
}
