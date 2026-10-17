import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Anthropic from '@anthropic-ai/sdk';

const mockEnv = vi.hoisted((): Record<string, string | undefined> => ({}));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('$lib/server/logger', () => ({ logger: log }));

import * as schema from './db/schema';
import { runMigrations } from './db/migrate';
import { getTotalResearchCost, renameDistillery } from './distilleries';
import {
	getVariantSuggestions,
	isVariantSearchRunning,
	rejectVariantSuggestion,
	searchDistilleryVariants
} from './distilleryVariantSearch';

// 21:30 Berlin (CEST) on 16.10.2026.
const NOW = new Date('2026-10-16T19:30:00Z');
const EARLIER = new Date('2026-09-01T10:00:00Z');

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
	mockEnv.ANTHROPIC_API_KEY = 'sk-test';
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
	tasting('revealed', '2026-10-01', ['Stoisha', 'Bunnahabhain', 'Blend', 'Stoisha', 'unknown']);
	// Released at 21:00, but not revealed: its names never go to the API.
	tasting('tonight', '2026-10-16', ['Secret Still']);
});

const variant = (v: string, target: string, kind = 'spelling', prefix: string | null = null) => ({
	variant: v,
	target,
	kind,
	prefix
});

function reply(variants: unknown[] | null): Anthropic.Message {
	return {
		id: 'msg',
		type: 'message',
		role: 'assistant',
		model: 'claude-opus-5-5',
		content:
			variants === null
				? []
				: [
						{
							type: 'tool_use',
							id: 't',
							name: 'report_spelling_variants',
							caller: { type: 'direct' },
							input: { variants }
						}
					],
		stop_reason: variants === null ? 'refusal' : 'tool_use',
		usage: {
			input_tokens: 1_000,
			output_tokens: 500,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation: null,
			server_tool_use: null
		}
	} as unknown as Anthropic.Message;
}

function fakeClient(...replies: Array<unknown[] | null>) {
	const createMessage = vi.fn(async (params: Anthropic.MessageStreamParams) => {
		void params;
		return reply(replies.length > 0 ? (replies.shift() as unknown[] | null) : []);
	});
	return { createMessage, createClient: vi.fn(() => createMessage) };
}

const sentNames = (createMessage: ReturnType<typeof fakeClient>['createMessage']) =>
	(createMessage.mock.calls[0][0].messages[0].content as string).split('\n').slice(1, -1);

const now = () => NOW;

function expectNoNamesLogged() {
	const logged = JSON.stringify([log.info.mock.calls, log.error.mock.calls]);
	for (const name of ['Stoisha', 'Bunnahabhain', 'unknown', 'Secret Still']) {
		expect(logged).not.toContain(name);
	}
}

describe('searchDistilleryVariants', () => {
	it('sends the distilleries of revealed tastings once each and stores the suggestions', async () => {
		const { createMessage, createClient } = fakeClient([
			variant('Stoisha', 'Bunnahabhain', 'brand', 'Stoisha'),
			variant('unknown', 'Unbekannt')
		]);

		expect(await searchDistilleryVariants(db, { createClient, now })).toEqual({
			status: 'searched',
			added: 2
		});

		expect(createClient).toHaveBeenCalledWith('sk-test');
		expect(sentNames(createMessage)).toEqual(['Stoisha', 'Bunnahabhain', 'unknown']);
		expect(getVariantSuggestions(db, NOW)).toEqual([
			{
				id: expect.any(Number),
				variantKey: 'stoisha',
				variantName: 'Stoisha',
				targetName: 'Bunnahabhain',
				kind: 'brand',
				prefix: 'Stoisha',
				bottles: 2
			},
			{
				id: expect.any(Number),
				variantKey: 'unknown',
				variantName: 'unknown',
				targetName: 'Unbekannt',
				kind: 'spelling',
				prefix: null,
				bottles: 1
			}
		]);
		// $4 per million input tokens, $20 per million output tokens.
		expect(getTotalResearchCost(db)).toBe(14_000);
		expect(log.info).toHaveBeenCalledWith(
			{ distilleries: 3, suggested: 2, added: 2 },
			'distillery variant search finished'
		);
		expectNoNamesLogged();
	});

	it('suggests neither an open nor a rejected pair again, in either direction', async () => {
		const { createClient } = fakeClient(
			[variant('Stoisha', 'Bunnahabhain', 'brand'), variant('unknown', 'Unbekannt')],
			[
				variant('Stoisha', 'Bunnahabhain'),
				variant('Bunnahabhain', 'Stoisha'),
				variant('unknown', 'Unbekannt'),
				variant('Stoisha', 'Caol Ila')
			]
		);
		await searchDistilleryVariants(db, { createClient, now });
		const unknown = getVariantSuggestions(db, NOW).find((s) => s.variantKey === 'unknown')!;
		expect(rejectVariantSuggestion(db, unknown.id)).toBe(true);

		expect(await searchDistilleryVariants(db, { createClient, now })).toEqual({
			status: 'searched',
			added: 1
		});
		expect(getVariantSuggestions(db, NOW).map((s) => s.targetName)).toEqual([
			'Bunnahabhain',
			'Caol Ila'
		]);
	});

	it('runs one search at a time', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const createMessage = vi.fn(async () => {
			await gate;
			return reply([]);
		});
		const createClient = () => createMessage;

		const first = searchDistilleryVariants(db, { createClient, now });
		expect(isVariantSearchRunning()).toBe(true);
		expect(await searchDistilleryVariants(db, { createClient, now })).toEqual({
			status: 'running'
		});
		release();
		expect(await first).toEqual({ status: 'searched', added: 0 });
		expect(isVariantSearchRunning()).toBe(false);
		expect(createMessage).toHaveBeenCalledTimes(1);
	});

	it('fails without result, counts the costs and frees the lock', async () => {
		const { createClient } = fakeClient(null);

		expect(await searchDistilleryVariants(db, { createClient, now })).toEqual({
			status: 'failed'
		});
		expect(getTotalResearchCost(db)).toBe(14_000);
		expect(isVariantSearchRunning()).toBe(false);
		expect(log.error).toHaveBeenCalledWith(
			{ err: expect.any(Error) },
			'distillery variant search failed'
		);
		expectNoNamesLogged();
	});

	it('fails on an API error', async () => {
		const createMessage = vi.fn(async () => {
			throw new Error('overloaded');
		});
		expect(await searchDistilleryVariants(db, { createClient: () => createMessage, now })).toEqual({
			status: 'failed'
		});
		expect(getTotalResearchCost(db)).toBe(0);
	});

	it('needs ANTHROPIC_API_KEY', async () => {
		delete mockEnv.ANTHROPIC_API_KEY;
		const { createClient } = fakeClient([]);
		expect(await searchDistilleryVariants(db, { createClient, now })).toEqual({
			status: 'no-key'
		});
		expect(createClient).not.toHaveBeenCalled();
	});

	it('makes no call for fewer than two distilleries', async () => {
		const { createClient } = fakeClient([]);
		expect(
			await searchDistilleryVariants(db, {
				createClient,
				now: () => new Date('2026-09-01T10:00:00Z')
			})
		).toEqual({ status: 'searched', added: 0 });
		expect(createClient).not.toHaveBeenCalled();
	});
});

describe('getVariantSuggestions', () => {
	it('hides a suggestion whose variant is gone, rejects only open ones', async () => {
		const { createClient } = fakeClient([
			variant('Stoisha', 'Bunnahabhain', 'brand'),
			variant('unknown', 'Unbekannt')
		]);
		await searchDistilleryVariants(db, { createClient, now });
		const [stoisha, unknown] = getVariantSuggestions(db, NOW);

		// Renamed by hand into something else: the open suggestion of the variant goes with it.
		renameDistillery(
			db,
			'unknown',
			{ name: 'Blend', prefix: null, facts: { country: null, region: null, capacity: null } },
			NOW
		);
		expect(getVariantSuggestions(db, NOW)).toEqual([stoisha]);
		expect(rejectVariantSuggestion(db, unknown.id)).toBe(false);

		expect(rejectVariantSuggestion(db, stoisha.id)).toBe(true);
		expect(rejectVariantSuggestion(db, stoisha.id)).toBe(false);
		expect(getVariantSuggestions(db, NOW)).toEqual([]);
	});
});
