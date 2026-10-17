import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';

const mockEnv = vi.hoisted((): Record<string, string | undefined> => ({}));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('$lib/server/logger', () => ({ logger: log }));

import * as schema from './db/schema';
import { runMigrations } from './db/migrate';
import {
	distilleryFactsJob,
	isDistilleryResearchRunning,
	requestDistilleryResearch,
	researchDistilleriesInBackground,
	runDistilleryResearch
} from './distilleryResearchJob';
import { StartupJobError } from './startupJobs';

const EARLIER = new Date('2026-09-01T10:00:00Z');
const WIKI = 'https://en.wikipedia.org/wiki/Distillery';

let db: ReturnType<typeof drizzle<typeof schema>>;

function tasting(id: string, date: string, distilleries: string[]) {
	db.insert(schema.tasting)
		.values({ id, slug: `slug-${id}`, name: id, tastingDate: date, createdAt: EARLIER })
		.run();
	db.insert(schema.tastingParticipant)
		.values({ id: `${id}-p`, tastingId: id, userId: 'u-anna', createdAt: EARLIER })
		.run();
	distilleries.forEach((distillery, index) => {
		db.insert(schema.tastingBottle)
			.values({
				id: `${id}-${index}`,
				participantId: `${id}-p`,
				slot: index + 1,
				alias: `${id}${index}`,
				distillery,
				abv: 46,
				smoke: 1,
				cask: 1,
				value: 1,
				updatedAt: EARLIER
			})
			.run();
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
	const sqlite = new Database(':memory:');
	runMigrations(sqlite, './drizzle');
	db = drizzle(sqlite, { schema });
	db.insert(schema.user)
		.values({
			id: 'u-anna',
			name: 'Anna',
			email: 'anna@example.com',
			username: 'Anna',
			createdAt: EARLIER,
			updatedAt: EARLIER
		})
		.run();
	tasting('revealed', '2026-10-01', ['Ardbeg', 'Lagavulin', 'Blend']);
});

const entry = (value: unknown) => ({ status: 'found', value, source_url: WIKI, quote: 'q' });

function reply(stopReason: string, content: unknown[]): Anthropic.Message {
	return {
		id: 'msg',
		type: 'message',
		role: 'assistant',
		model: 'claude-opus-5-5',
		content,
		stop_reason: stopReason,
		usage: {
			input_tokens: 100,
			output_tokens: 10,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation: null,
			server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 }
		}
	} as unknown as Anthropic.Message;
}

const nameOf = (params: Anthropic.MessageStreamParams) =>
	/<distillery_name>(.*?)<\/distillery_name>/.exec(params.messages[0].content as string)![1];

/** A client that finds every value, refuses or fails for the given names. */
function fakeClient(behaviour: Record<string, 'refuse' | 'fail'> = {}) {
	const researched: string[] = [];
	const createMessage = vi.fn(async (params: Anthropic.MessageStreamParams) => {
		const name = nameOf(params);
		researched.push(name);
		if (behaviour[name] === 'fail') throw new Error('overloaded');
		if (behaviour[name] === 'refuse') return reply('refusal', []);
		return reply('tool_use', [
			{
				type: 'web_search_tool_result',
				tool_use_id: 's',
				caller: { type: 'direct' },
				content: [
					{
						type: 'web_search_result',
						url: WIKI,
						title: 't',
						encrypted_content: 'e',
						page_age: null
					}
				]
			},
			{
				type: 'tool_use',
				id: 't',
				name: 'report_distillery_facts',
				caller: { type: 'direct' },
				input: { country: entry('Schottland'), region: entry('Islay'), capacity: entry(1_000) }
			}
		]);
	});
	return { createMessage, researched, createClient: vi.fn(() => createMessage) };
}

// The job only runs from the admin page's button.
const context = (limit?: number) => ({ trigger: 'manual' as const, limit, progress: vi.fn() });

const row = (key: string) =>
	db.select().from(schema.distillery).where(eq(schema.distillery.nameKey, key)).get();

// No distillery name in anything logged above debug or in a job message.
function expectNoNamesLogged() {
	const logged = JSON.stringify([log.info.mock.calls, log.error.mock.calls, log.warn.mock.calls]);
	expect(logged).not.toMatch(/Ardbeg|Lagavulin|Bushmills/);
}

describe('distilleryFactsJob', () => {
	it('never runs after a deployment and offers 5 or 10 besides all', () => {
		expect(distilleryFactsJob(db)).toMatchObject({ manualOnly: true, batchSizes: [5, 10] });
	});

	it('fails with a notice without ANTHROPIC_API_KEY', async () => {
		const { createClient } = fakeClient();
		const job = distilleryFactsJob(db, createClient);

		await expect(job.run(context())).rejects.toEqual(
			new StartupJobError('ANTHROPIC_API_KEY is not set', 'ANTHROPIC_API_KEY ist nicht gesetzt.')
		);
		expect(createClient).not.toHaveBeenCalled();
	});

	it('researches every distillery of released tastings, without placeholders', async () => {
		mockEnv.ANTHROPIC_API_KEY = 'sk-test';
		const { createClient, researched } = fakeClient();
		const ctx = context();

		expect(await distilleryFactsJob(db, createClient).run(ctx)).toBe(
			'2 Destillerien recherchiert.'
		);

		expect(createClient).toHaveBeenCalledWith('sk-test');
		expect(researched).toEqual(['Ardbeg', 'Lagavulin']);
		expect(ctx.progress.mock.calls).toEqual([
			[0, 2],
			[1, 2],
			[2, 2]
		]);
		expect(row('ardbeg')).toMatchObject({
			country: 'Schottland',
			countryState: 'found',
			region: 'Islay',
			capacity: 1_000
		});
		expect(db.select().from(schema.distilleryResearchCall).all()).toHaveLength(2);
		expectNoNamesLogged();
	});

	it('has nothing to do once every value is decided', async () => {
		mockEnv.ANTHROPIC_API_KEY = 'sk-test';
		const { createClient, researched } = fakeClient();
		await distilleryFactsJob(db, createClient).run(context());

		expect(await distilleryFactsJob(db, createClient).run(context())).toBe(
			'Keine Destillerie zu recherchieren.'
		);
		expect(researched).toHaveLength(2);
	});

	it('researches at most the chosen number, the rest stays for the next run', async () => {
		mockEnv.ANTHROPIC_API_KEY = 'sk-test';
		tasting('more', '2026-10-02', ['Bushmills']);
		const { createClient, researched } = fakeClient();
		const ctx = context(2);

		expect(await distilleryFactsJob(db, createClient).run(ctx)).toBe(
			'2 Destillerien recherchiert. Noch 1 weitere offen.'
		);
		expect(researched).toEqual(['Ardbeg', 'Lagavulin']);
		expect(ctx.progress.mock.calls).toEqual([
			[0, 2],
			[1, 2],
			[2, 2]
		]);
		expect(row('bushmills')).toBeUndefined();

		expect(await distilleryFactsJob(db, createClient).run(context(2))).toBe(
			'1 Destillerie recherchiert.'
		);
		expect(researched).toEqual(['Ardbeg', 'Lagavulin', 'Bushmills']);
	});

	it('retries the values not found, unlike the timer', async () => {
		mockEnv.ANTHROPIC_API_KEY = 'sk-test';
		for (const key of ['ardbeg', 'lagavulin']) {
			db.insert(schema.distillery)
				.values({
					nameKey: key,
					country: 'Schottland',
					countryState: 'admin',
					region: 'Islay',
					regionState: 'admin',
					capacityState: 'empty',
					updatedAt: EARLIER
				})
				.run();
		}
		const { createClient, createMessage, researched } = fakeClient();

		expect(await runDistilleryResearch(db, 'pending', { createMessage })).toEqual({
			total: 0,
			failed: 0,
			remaining: 0
		});
		expect(await distilleryFactsJob(db, createClient).run(context())).toBe(
			'2 Destillerien recherchiert.'
		);
		expect(researched).toEqual(['Ardbeg', 'Lagavulin']);
		expect(row('ardbeg')).toMatchObject({
			capacity: 1_000,
			capacityState: 'found',
			regionState: 'admin'
		});
	});

	it('goes on after a failure and reports the count only', async () => {
		mockEnv.ANTHROPIC_API_KEY = 'sk-test';
		const { createClient, researched } = fakeClient({ Ardbeg: 'fail', Lagavulin: 'refuse' });

		tasting('more', '2026-10-02', ['Bushmills']);

		await expect(distilleryFactsJob(db, createClient).run(context(2))).rejects.toEqual(
			new StartupJobError(
				'2 of 2 distillery researches failed',
				'2 von 2 Destillerien ließen sich nicht vollständig recherchieren, Details im Server-Log. Noch 1 weitere offen.'
			)
		);

		expect(researched).toEqual(['Ardbeg', 'Lagavulin']);
		// Nothing written, the values stay "never researched" – the refusal still costs.
		expect(row('ardbeg')).toBeUndefined();
		expect(row('lagavulin')).toBeUndefined();
		expect(db.select().from(schema.distilleryResearchCall).all()).toHaveLength(1);
		expect(log.error).toHaveBeenCalledWith(
			{ err: expect.any(Error) },
			'distillery research failed'
		);
		expectNoNamesLogged();
	});
});

describe('requestDistilleryResearch', () => {
	it('runs one research at a time with at most one shared follow-up', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const { createMessage, researched } = fakeClient();
		const slowFirst = vi.fn(async (params: Anthropic.MessageStreamParams) => {
			if (researched.length === 0) await gate;
			return createMessage(params);
		});
		// Only Ardbeg to start with (Blend is a placeholder).
		db.delete(schema.tastingBottle).where(eq(schema.tastingBottle.distillery, 'Lagavulin')).run();

		expect(isDistilleryResearchRunning()).toBe(false);
		const first = requestDistilleryResearch(db, 'pending', { createMessage: slowFirst });
		expect(isDistilleryResearchRunning()).toBe(true);
		// Revealed while the first run waits on the API: it listed its targets already.
		tasting('new', '2026-10-03', ['Bushmills']);
		const second = requestDistilleryResearch(db, 'pending', { createMessage: slowFirst });
		const third = requestDistilleryResearch(db, 'manual', { createMessage: slowFirst });
		expect(third).toBe(second);

		release();
		expect(await first).toEqual({ total: 1, failed: 0, remaining: 0 });
		// Ardbeg isn't paid twice: the follow-up only finds Bushmills.
		expect(await second).toEqual({ total: 1, failed: 0, remaining: 0 });
		expect(researched).toEqual(['Ardbeg', 'Bushmills']);
		// Running until the follow-up is over, too.
		await Promise.resolve();
		expect(isDistilleryResearchRunning()).toBe(false);
	});

	it('passes a failed run on to whoever waits for it', async () => {
		const broken = {
			select: () => {
				throw new Error('db down');
			}
		} as unknown as typeof db;
		const { createMessage } = fakeClient();

		await expect(requestDistilleryResearch(broken, 'pending', { createMessage })).rejects.toThrow(
			'db down'
		);
		// The lock is free again.
		expect(await runDistilleryResearch(db, 'pending', { createMessage })).toEqual({
			total: 2,
			failed: 0,
			remaining: 0
		});
	});

	it.each([
		{ limits: [1, 2], researched: 2 },
		{ limits: [1, undefined], researched: 3 }
	])('gives the shared follow-up the largest limit of $limits', async ({ limits, researched }) => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const client = fakeClient();
		const slowFirst = vi.fn(async (params: Anthropic.MessageStreamParams) => {
			if (client.researched.length === 0) await gate;
			return client.createMessage(params);
		});
		db.delete(schema.tastingBottle).where(eq(schema.tastingBottle.distillery, 'Lagavulin')).run();

		const first = requestDistilleryResearch(db, 'pending', { createMessage: slowFirst });
		tasting('new', '2026-10-03', ['Bushmills', 'Talisker', 'Oban']);
		const followUps = limits.map((limit) =>
			requestDistilleryResearch(db, 'manual', { createMessage: slowFirst, limit })
		);

		release();
		await first;
		expect(await followUps[0]).toEqual({
			total: researched,
			failed: 0,
			remaining: 3 - researched
		});
		expect(client.researched).toHaveLength(1 + researched);
	});
});

describe('researchDistilleriesInBackground', () => {
	it('does nothing without a key but log on debug', () => {
		const { createClient } = fakeClient();
		researchDistilleriesInBackground(db, createClient);

		expect(createClient).not.toHaveBeenCalled();
		expect(log.debug).toHaveBeenCalledWith('no ANTHROPIC_API_KEY, distillery research skipped');
	});

	it('researches the values never researched in the background', async () => {
		mockEnv.ANTHROPIC_API_KEY = 'sk-test';
		const { createClient, researched } = fakeClient();

		researchDistilleriesInBackground(db, createClient);

		await vi.waitFor(() => expect(row('lagavulin')?.countryState).toBe('found'));
		expect(researched).toEqual(['Ardbeg', 'Lagavulin']);
	});

	it('logs a failed run', async () => {
		mockEnv.ANTHROPIC_API_KEY = 'sk-test';
		const broken = {
			select: () => {
				throw new Error('db down');
			}
		} as unknown as typeof db;

		researchDistilleriesInBackground(broken, fakeClient().createClient);

		await vi.waitFor(() =>
			expect(log.error).toHaveBeenCalledWith(
				{ err: expect.any(Error) },
				'distillery research run failed'
			)
		);
	});
});
