import type { FastifyRequest } from 'fastify';
import { z, type ZodTypeAny } from 'zod';
import { badRequest } from './errors.js';

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest('Ungültige Eingabe', r.error.flatten());
  }
  return r.data;
}

export const idParam = z.object({ id: z.string().min(1) });

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

export function clientMeta(req: FastifyRequest) {
  return { ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) };
}

/** Optionale Zeichenkette: leere Strings werden zu null */
export const optStr = z
  .string()
  .trim()
  .max(5000)
  .nullish()
  .transform((v) => (v === '' || v === undefined ? null : v));

export const money = z.coerce.number().int();
export const dateStr = z.coerce.date();
