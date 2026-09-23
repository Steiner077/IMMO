import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import type { AuthUser } from '../auth/context.js';
import { notifyUsers } from './notifications.js';

const FULL_ACCESS = ['SUPER_ADMIN', 'OWNER', 'MANAGER'];

export function conversationScope(user: AuthUser): Prisma.ConversationWhereInput {
  if (FULL_ACCESS.includes(user.role)) return { organizationId: user.organizationId };
  return { organizationId: user.organizationId, participants: { some: { userId: user.id } } };
}

export async function listConversations(user: AuthUser, filter: Prisma.ConversationWhereInput = {}) {
  const convs = await prisma.conversation.findMany({
    where: { ...conversationScope(user), ...filter },
    include: {
      participants: { include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { sender: { select: { firstName: true, lastName: true } } } },
      property: { select: { id: true, name: true } },
      unit: { select: { id: true, label: true } },
      tenant: { select: { id: true, firstName: true, lastName: true, companyName: true } },
      damageReport: { select: { id: true, ticketNumber: true, title: true } },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 200,
  });
  return convs.map((c) => {
    const me = c.participants.find((p) => p.userId === user.id);
    const last = c.messages[0];
    return {
      ...c,
      lastMessage: last ?? null,
      unread: !!last && last.senderId !== user.id && (!me?.lastReadAt || me.lastReadAt < last.createdAt),
    };
  });
}

export async function getConversation(user: AuthUser, id: string) {
  const c = await prisma.conversation.findFirst({
    where: { id, ...conversationScope(user) },
    include: {
      participants: { include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { sender: { select: { id: true, firstName: true, lastName: true, role: true } }, attachments: { where: { deletedAt: null }, select: { id: true, name: true, mimeType: true } } },
      },
      property: { select: { id: true, name: true } },
      unit: { select: { id: true, label: true } },
      tenant: { select: { id: true, firstName: true, lastName: true, companyName: true } },
      damageReport: { select: { id: true, ticketNumber: true, title: true } },
      document: { select: { id: true, name: true } },
    },
  });
  if (!c) throw notFound('Unterhaltung');
  await prisma.conversationParticipant.upsert({
    where: { conversationId_userId: { conversationId: id, userId: user.id } },
    update: { lastReadAt: new Date() },
    create: { conversationId: id, userId: user.id, lastReadAt: new Date() },
  }).catch(() => undefined);
  return c;
}

export async function createConversation(
  user: AuthUser,
  input: {
    subject: string;
    body: string;
    participantIds: string[];
    propertyId?: string | null;
    unitId?: string | null;
    tenantId?: string | null;
    damageReportId?: string | null;
    documentId?: string | null;
  },
) {
  const participants = await prisma.user.findMany({ where: { id: { in: input.participantIds }, organizationId: user.organizationId, isActive: true } });
  if (participants.length !== new Set(input.participantIds).size) throw badRequest('Ungültige Empfänger.');
  const conv = await prisma.conversation.create({
    data: {
      organizationId: user.organizationId,
      subject: input.subject,
      propertyId: input.propertyId ?? null,
      unitId: input.unitId ?? null,
      tenantId: input.tenantId ?? null,
      damageReportId: input.damageReportId ?? null,
      documentId: input.documentId ?? null,
      participants: { create: [...new Set([user.id, ...input.participantIds])].map((userId) => ({ userId, lastReadAt: userId === user.id ? new Date() : null })) },
      messages: { create: { senderId: user.id, body: input.body } },
    },
  });
  await notifyUsers(
    participants.filter((p) => p.id !== user.id).map((p) => p.id),
    { organizationId: user.organizationId, type: 'MESSAGE_NEW', title: `Neue Nachricht: ${input.subject}`, body: `${user.firstName} ${user.lastName}: ${input.body.slice(0, 140)}`, link: `/nachrichten/${conv.id}`, entityType: 'Conversation', entityId: conv.id },
  );
  return conv;
}

export async function sendMessage(user: AuthUser, conversationId: string, body: string) {
  const c = await prisma.conversation.findFirst({ where: { id: conversationId, ...conversationScope(user) }, include: { participants: true } });
  if (!c) throw notFound('Unterhaltung');
  const msg = await prisma.$transaction(async (tx) => {
    const m = await tx.message.create({ data: { conversationId, senderId: user.id, body } });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: m.createdAt } });
    await tx.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      update: { lastReadAt: new Date() },
      create: { conversationId, userId: user.id, lastReadAt: new Date() },
    });
    return m;
  });
  await notifyUsers(
    c.participants.filter((p) => p.userId !== user.id).map((p) => p.userId),
    { organizationId: user.organizationId, type: 'MESSAGE_NEW', title: `Neue Nachricht: ${c.subject}`, body: `${user.firstName} ${user.lastName}: ${body.slice(0, 140)}`, link: `/nachrichten/${conversationId}`, entityType: 'Conversation', entityId: conversationId },
  );
  return msg;
}
