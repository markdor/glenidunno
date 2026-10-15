// Startup jobs as the admin page shows them (the runner lives in
// $lib/server/startupJobs.ts). Free of server imports, the page uses it.

/** `pending`: never ran yet. */
export type StartupJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type StartupJobOverview = {
	id: string;
	title: string;
	description: string;
	status: StartupJobStatus;
	startedAt: Date | null;
	finishedAt: Date | null;
	/** The job's summary or a text safe to show, never an internal error. */
	message: string | null;
	progress: { done: number; total: number } | null;
};

/** `depends()` key of the admin page's job list: polled while a job runs. */
export const STARTUP_JOBS_DEPENDENCY = 'app:startup-jobs';

/** How often the admin page reloads the job list while one runs. */
export const STARTUP_JOBS_POLL_MS = 2_000;
