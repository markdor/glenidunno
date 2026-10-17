import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { StartupJobOverview } from '$lib/startupJobs';
import type * as Schema from './db/schema';
import { startupJob } from './db/schema';
import { logger } from './logger';

// One-off background jobs after a deployment – work a Drizzle migration can't
// do: long-running, with files or other services (e.g. the PDFs of all stored
// presentations). Every job not succeeded yet runs after the start (init hook
// in hooks.server.ts), one after the other, while the app already serves –
// except the manual ones (e.g. the paid distillery research); the admin page
// shows them all and (re)starts any of them. A quick change of data only
// stays a Drizzle custom migration.

type Db = BetterSQLite3Database<typeof Schema>;

/** A failure the job explains itself: `userMessage` is shown on the admin page. */
export class StartupJobError extends Error {
	constructor(
		message: string,
		public readonly userMessage: string
	) {
		super(message);
		this.name = 'StartupJobError';
	}
}

export type StartupJobContext = {
	/** `startup`: the run after a deployment, `manual`: the admin's button. */
	trigger: 'startup' | 'manual';
	/** The admin's choice of `batchSizes`: at most this many items, all without. */
	limit?: number;
	/** How far the job is, shown live on the admin page. */
	progress(done: number, total: number): void;
};

export type StartupJob = {
	/** Never changes once deployed – its row hangs on it. Date first, so ids sort by age. */
	id: string;
	title: string;
	description: string;
	/** Never runs after a deployment, only from the admin page's button. */
	manualOnly?: boolean;
	/** Offered next to the button besides "all", the choice arrives as `limit`. */
	batchSizes?: readonly number[];
	/** Has to be safe to run again. Resolves to a summary for the admin page. */
	run(context: StartupJobContext): Promise<string>;
};

const UNEXPECTED_MESSAGE = 'Unerwarteter Fehler, Details im Server-Log.';
const INTERRUPTED_MESSAGE = 'Durch einen Neustart der App unterbrochen.';

// Jobs running in this process: the same job never runs twice at once.
const active = new Set<string>();

export function isStartupJobRunning(id: string): boolean {
	return active.has(id);
}

/**
 * Runs a job and records it, resolves once it is done – it never rejects, a
 * failure is recorded. The row says "running" before the first await, so a
 * caller that doesn't wait (the admin's button) sees it right away. `false`
 * if the job is running already.
 */
export async function runStartupJob(
	db: Db,
	job: StartupJob,
	trigger: StartupJobContext['trigger'],
	limit?: number
): Promise<boolean> {
	if (active.has(job.id)) return false;
	active.add(job.id);
	const started = {
		status: 'running' as const,
		startedAt: new Date(),
		finishedAt: null,
		message: null,
		progressDone: null,
		progressTotal: null
	};
	db.insert(startupJob)
		.values({ id: job.id, ...started })
		.onConflictDoUpdate({ target: startupJob.id, set: started })
		.run();
	logger.info({ job: job.id, trigger, limit }, 'startup job started');

	try {
		const summary = await job.run({
			trigger,
			limit,
			progress: (done, total) => {
				db.update(startupJob)
					.set({ progressDone: done, progressTotal: total })
					.where(eq(startupJob.id, job.id))
					.run();
			}
		});
		finish(db, job.id, 'succeeded', summary);
		logger.info({ job: job.id, summary }, 'startup job succeeded');
	} catch (err: unknown) {
		logger.error({ err, job: job.id }, 'startup job failed');
		finish(
			db,
			job.id,
			'failed',
			err instanceof StartupJobError ? err.userMessage : UNEXPECTED_MESSAGE
		);
	} finally {
		active.delete(job.id);
	}
	return true;
}

function finish(db: Db, id: string, status: 'succeeded' | 'failed', message: string) {
	db.update(startupJob)
		.set({ status, message, finishedAt: new Date() })
		.where(eq(startupJob.id, id))
		.run();
}

/**
 * After the start: every job that hasn't succeeded yet, one after the other
 * – new ones, failed ones (e.g. a service wasn't up yet) and interrupted ones.
 * Manual jobs wait for the admin's button, also after an interruption.
 */
export async function runPendingStartupJobs(db: Db, jobs: readonly StartupJob[]): Promise<void> {
	const rows = db.select({ id: startupJob.id, status: startupJob.status }).from(startupJob).all();
	// "Running" without running here: the process that ran it is gone.
	for (const row of rows) {
		if (row.status === 'running' && !active.has(row.id)) {
			finish(db, row.id, 'failed', INTERRUPTED_MESSAGE);
		}
	}
	const succeeded = new Set(rows.filter((r) => r.status === 'succeeded').map((r) => r.id));
	for (const job of jobs) {
		if (!succeeded.has(job.id) && !job.manualOnly) await runStartupJob(db, job, 'startup');
	}
}

/** The admin page's list: every job with its last run, the newest job first. */
export function getStartupJobOverview(db: Db, jobs: readonly StartupJob[]): StartupJobOverview[] {
	const rows = new Map(
		db
			.select()
			.from(startupJob)
			.all()
			.map((row) => [row.id, row])
	);
	return [...jobs].reverse().map((job): StartupJobOverview => {
		const row = rows.get(job.id);
		return {
			id: job.id,
			title: job.title,
			description: job.description,
			status: row?.status ?? 'pending',
			startedAt: row?.startedAt ?? null,
			finishedAt: row?.finishedAt ?? null,
			message: row?.message ?? null,
			progress:
				row && row.progressDone !== null && row.progressTotal !== null
					? { done: row.progressDone, total: row.progressTotal }
					: null,
			manualOnly: job.manualOnly ?? false,
			batchSizes: job.batchSizes ?? []
		};
	});
}
