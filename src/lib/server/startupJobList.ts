import { db } from './db';
import { distilleryFactsJob } from './distilleryResearchJob';
import { presentationPdfJob } from './presentationPdfJob';
import type { StartupJob } from './startupJobs';

/**
 * Every startup job in the order they came: a new feature that needs one
 * appends it here (see startupJobs.ts). A job stays in the list once it ran,
 * the admin page shows it and can restart it.
 */
export const STARTUP_JOBS: readonly StartupJob[] = [presentationPdfJob(db), distilleryFactsJob(db)];
