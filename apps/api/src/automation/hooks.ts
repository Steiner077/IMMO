import type { AuthUser } from '../auth/context.js';
import { getOrgSettings } from '../services/settings.js';
import { runJob } from './jobs.js';

/** Wird nach jeder erfolgreichen Verbuchung ausgeführt. */
export async function runPostPostingAutomations(organizationId: string, user: AuthUser) {
  const s = await getOrgSettings(organizationId);
  if (s.autoExcelSnapshot) await runJob('excel-snapshot', { organizationId, trigger: 'EVENT', userId: user.id });
}
