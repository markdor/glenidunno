import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import * as schema from './db/schema';
import { runMigrations } from './db/migrate';
import { logger } from './logger';
import {
	getStartupJobOverview,
	isStartupJobRunning,
	runPendingStartupJobs,
	runStartupJob,
	StartupJobError,
	type StartupJob,
	type StartupJobContext
} from './startupJobs';

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
	const sqlite = new Database(':memory:');
	runMigrations(sqlite, './drizzle');
	db = drizzle(sqlite, { schema });
	vi.clearAllMocks();
});

function job(id: string, run: StartupJob['run'] = async () => 'erledigt'): StartupJob {
	return { id, title: `Job ${id}`, description: 'Ein Test', run };
}

/** A job that runs until the test lets it finish. */
function pausedJob(id: string) {
	let finish!: (summary: string) => void;
	let context!: StartupJobContext;
	const paused = job(id, (ctx) => {
		context = ctx;
		return new Promise<string>((resolve) => (finish = resolve));
	});
	return { job: paused, finish: (summary: string) => finish(summary), context: () => context };
}

const row = (id: string) =>
	db
		.select()
		.from(schema.startupJob)
		.all()
		.find((r) => r.id === id);

describe('runStartupJob', () => {
	it('records a run as running at once, with its progress, then as succeeded', async () => {
		const { job: paused, finish, context } = pausedJob('2026-01-a');

		const done = runStartupJob(db, paused, 'manual', 5);

		expect(row('2026-01-a')).toMatchObject({ status: 'running', finishedAt: null });
		expect(isStartupJobRunning('2026-01-a')).toBe(true);
		expect(context()).toMatchObject({ trigger: 'manual', limit: 5 });
		context().progress(3, 7);
		expect(getStartupJobOverview(db, [paused])[0]).toMatchObject({
			status: 'running',
			progress: { done: 3, total: 7 }
		});

		finish('3 Dinge erledigt.');
		expect(await done).toBe(true);
		expect(row('2026-01-a')).toMatchObject({ status: 'succeeded', message: '3 Dinge erledigt.' });
		expect(row('2026-01-a')?.finishedAt).toBeInstanceOf(Date);
		expect(isStartupJobRunning('2026-01-a')).toBe(false);
	});

	it('never runs the same job twice at once', async () => {
		const { job: paused, finish } = pausedJob('2026-01-b');
		const first = runStartupJob(db, paused, 'startup');

		expect(await runStartupJob(db, paused, 'manual')).toBe(false);

		finish('ok');
		expect(await first).toBe(true);
	});

	it('shows the message of a StartupJobError, never an internal one', async () => {
		await runStartupJob(
			db,
			job('2026-01-c', async () => {
				throw new StartupJobError('gotenberg unreachable', 'Gotenberg ist nicht erreichbar.');
			}),
			'startup'
		);
		await runStartupJob(
			db,
			job('2026-01-d', async () => {
				throw new Error('SQLITE_CORRUPT: internal details');
			}),
			'startup'
		);

		expect(row('2026-01-c')).toMatchObject({
			status: 'failed',
			message: 'Gotenberg ist nicht erreichbar.'
		});
		expect(row('2026-01-d')).toMatchObject({
			status: 'failed',
			message: 'Unerwarteter Fehler, Details im Server-Log.'
		});
		expect(logger.error).toHaveBeenCalledTimes(2);
	});

	it('starts a finished job afresh', async () => {
		const failing = job('2026-01-e', async () => {
			throw new StartupJobError('x', 'Kaputt.');
		});
		await runStartupJob(db, failing, 'startup');
		const { job: paused, finish } = pausedJob('2026-01-e');

		const again = runStartupJob(db, paused, 'manual');

		expect(row('2026-01-e')).toMatchObject({ status: 'running', message: null, finishedAt: null });
		finish('ok');
		await again;
	});
});

describe('runPendingStartupJobs', () => {
	it('runs new and failed jobs one after the other and skips succeeded ones', async () => {
		const order: string[] = [];
		const tracked = (id: string, outcome: 'ok' | 'fail' = 'ok') =>
			job(id, async () => {
				order.push(`start ${id}`);
				await new Promise((resolve) => setTimeout(resolve, 5));
				order.push(`end ${id}`);
				if (outcome === 'fail') throw new StartupJobError('x', 'Kaputt.');
				return 'ok';
			});
		await runStartupJob(db, tracked('2026-01-done'), 'startup');
		await runStartupJob(db, tracked('2026-01-failed', 'fail'), 'startup');
		order.length = 0;

		await runPendingStartupJobs(db, [
			tracked('2026-01-done'),
			tracked('2026-01-failed'),
			tracked('2026-02-new')
		]);

		expect(order).toEqual([
			'start 2026-01-failed',
			'end 2026-01-failed',
			'start 2026-02-new',
			'end 2026-02-new'
		]);
		expect(row('2026-01-failed')?.status).toBe('succeeded');
		expect(row('2026-02-new')?.status).toBe('succeeded');
	});

	it('marks a run the previous process left behind as interrupted, then runs it again', async () => {
		db.insert(schema.startupJob)
			.values({ id: '2026-01-gone', status: 'running', startedAt: new Date() })
			.run();
		const run = vi.fn(async () => 'ok');

		await runPendingStartupJobs(db, [job('2026-01-gone', run)]);

		expect(run).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'startup' }));
		expect(row('2026-01-gone')).toMatchObject({ status: 'succeeded', message: 'ok' });
	});

	it('leaves manual jobs to the button, also after an interruption', async () => {
		db.insert(schema.startupJob)
			.values({ id: '2026-01-paid', status: 'running', startedAt: new Date() })
			.run();
		const run = vi.fn(async () => 'ok');

		await runPendingStartupJobs(db, [
			{ ...job('2026-01-paid', run), manualOnly: true },
			{ ...job('2026-02-paid', run), manualOnly: true }
		]);

		expect(run).not.toHaveBeenCalled();
		expect(row('2026-01-paid')).toMatchObject({
			status: 'failed',
			message: 'Durch einen Neustart der App unterbrochen.'
		});
		expect(row('2026-02-paid')).toBeUndefined();
	});

	it('records the interruption when the job is no longer known', async () => {
		db.insert(schema.startupJob)
			.values({ id: '2025-12-removed', status: 'running', startedAt: new Date() })
			.run();

		await runPendingStartupJobs(db, []);

		expect(row('2025-12-removed')).toMatchObject({
			status: 'failed',
			message: 'Durch einen Neustart der App unterbrochen.'
		});
	});
});

describe('getStartupJobOverview', () => {
	it('lists every known job, the newest first, the never started ones as pending', async () => {
		const older = job('2026-01-old');
		await runStartupJob(db, older, 'startup');

		expect(getStartupJobOverview(db, [older, job('2026-02-new')])).toEqual([
			{
				id: '2026-02-new',
				title: 'Job 2026-02-new',
				description: 'Ein Test',
				status: 'pending',
				startedAt: null,
				finishedAt: null,
				message: null,
				progress: null,
				manualOnly: false,
				batchSizes: []
			},
			expect.objectContaining({ id: '2026-01-old', status: 'succeeded', message: 'erledigt' })
		]);
	});

	it('tells the page which jobs are manual and which batch sizes they offer', () => {
		const paid = { ...job('2026-01-paid'), manualOnly: true, batchSizes: [5, 10] };

		expect(getStartupJobOverview(db, [paid])).toEqual([
			expect.objectContaining({ manualOnly: true, batchSizes: [5, 10] })
		]);
	});
});
