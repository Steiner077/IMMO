import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

export interface AccessTokenPayload {
  sub: string;
  org: string;
  role: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'immo-api',
    audience: 'immo',
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.JWT_SECRET, { issuer: 'immo-api', audience: 'immo' }) as AccessTokenPayload;
}

export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
