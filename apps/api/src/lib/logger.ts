import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['req.headers.authorization', 'req.headers.cookie', 'password', 'passwordHash', '*.password'],
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } } : undefined,
});
