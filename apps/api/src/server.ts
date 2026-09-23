import { config } from './config.js';
import { buildApp } from './app.js';
import { startScheduler } from './automation/scheduler.js';
import { prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';

const app = await buildApp();
let timer: NodeJS.Timeout | undefined;

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  if (config.AUTOMATION_ENABLED) timer = startScheduler();
} catch (e) {
  logger.error(e);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    logger.info(`${sig} empfangen – fahre herunter`);
    if (timer) clearInterval(timer);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled rejection'));
