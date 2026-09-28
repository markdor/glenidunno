import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { TastingBottle } from '$lib/tasting';
import * as schema from './db/schema';
import { hashTastingToken } from './tastingToken';
import {
	createTasting,
	deleteTasting,
	findParticipantByToken,
	getAdminTastingDetail,
	getParticipantView,
	getStartPageSummary,
	listTastings,
	regenerateParticipantToken,
	saveBottle,
	TastingValidationError,
	updateTastingDate,
	validateTastingDate
} from './tastings';

let db: BetterSQLite3Database<typeof schema>;

// Tasting on Saturday 24.10.2026 (CEST): 18:00 Berlin = 16:00 UTC,
// reveal on Sunday 9:00 Berlin (CET after the switch) = 08:00 UTC.
const TASTING_DATE = '2026-10-24';
const ENTRY = new Date('2026-10-20T10:00:00Z');
const ORDER = new Date('2026-10-24T16:00:00Z');
const REVEALED = new Date('2026-10-25T08:00:00Z');

function bottle(overrides: Partial<TastingBottle> = {}): TastingBottle {
	return {
		alias: 'Nebel',
		distillery: 'Ardbeg',
		bottler: null,
		bottling: 'Uigeadail',
		age: null,
		whiskybaseUrl: 'https://www.whiskybase.com/whiskies/whisky/1',
		smoke: 5,
		cask: 3,
		abv: 54.2,
		value: 4,
		...overrides
	};
}

function setup(tastingDate = TASTING_DATE) {
	const created = createTasting(
		db,
		{
			name: 'Herbst-Tasting',
			tastingDate,
			bottlesPerParticipant: 2,
			participantNames: ['Anna', 'Ben', 'Cem']
		},
		ENTRY
	);
	const [anna, ben, cem] = created.tokens.map((t) => findParticipantByToken(db, t.token)!);
	return { id: created.id, tokens: created.tokens, anna, ben, cem };
}

beforeEach(() => {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: './drizzle' });
});

describe('createTasting', () => {
	it('returns the plaintext tokens once and stores only their hashes', () => {
		const { tokens } = setup();
		expect(tokens.map((t) => t.name)).toEqual(['Anna', 'Ben', 'Cem']);

		const stored = db.select().from(schema.tastingParticipant).all();
		expect(stored.map((p) => p.tokenHash).sort()).toEqual(
			tokens.map((t) => hashTastingToken(t.token)).sort()
		);
		const dump = JSON.stringify(stored);
		for (const t of tokens) expect(dump).not.toContain(t.token);
	});
});

describe('findParticipantByToken', () => {
	it('finds the holder of a token', () => {
		const { tokens, anna } = setup();
		expect(anna).toMatchObject({ name: 'Anna', tastingName: 'Herbst-Tasting' });
		expect(findParticipantByToken(db, tokens[0].token)?.id).toBe(anna.id);
	});

	it('returns null for unknown, replaced and deleted tokens alike', () => {
		const { id, tokens, anna } = setup();
		expect(findParticipantByToken(db, 'x'.repeat(32))).toBeNull();

		regenerateParticipantToken(db, id, anna.id);
		expect(findParticipantByToken(db, tokens[0].token)).toBeNull();

		deleteTasting(db, id);
		expect(findParticipantByToken(db, tokens[1].token)).toBeNull();
	});
});

describe('saveBottle', () => {
	it('inserts and then updates the bottle in the holder’s slot', () => {
		const { anna } = setup();
		expect(saveBottle(db, anna, 1, bottle(), ENTRY)).toBe('saved');
		expect(saveBottle(db, anna, 1, bottle({ distillery: 'Laphroaig' }), ENTRY)).toBe('saved');

		const rows = db.select().from(schema.tastingBottle).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ participantId: anna.id, slot: 1, distillery: 'Laphroaig' });
	});

	it('rejects an alias used by someone else, ignoring case and umlaut case', () => {
		const { anna, ben } = setup();
		saveBottle(db, anna, 1, bottle({ alias: 'Ölfass' }), ENTRY);
		expect(saveBottle(db, ben, 1, bottle({ alias: 'ÖLFASS' }), ENTRY)).toBe('alias-taken');
		expect(saveBottle(db, ben, 1, bottle({ alias: 'ölfass' }), ENTRY)).toBe('alias-taken');
	});

	it('rejects an alias the holder already uses in another slot', () => {
		const { anna } = setup();
		saveBottle(db, anna, 1, bottle({ alias: 'Nebel' }), ENTRY);
		expect(saveBottle(db, anna, 2, bottle({ alias: 'nebel' }), ENTRY)).toBe('alias-taken');
	});

	it('lets the holder keep the alias of the bottle being updated', () => {
		const { anna } = setup();
		saveBottle(db, anna, 1, bottle({ alias: 'Nebel' }), ENTRY);
		expect(saveBottle(db, anna, 1, bottle({ alias: 'NEBEL' }), ENTRY)).toBe('saved');
	});

	it('refuses to save from 18:00 on the tasting day', () => {
		const { anna } = setup();
		const justBefore = new Date(ORDER.getTime() - 1000);
		expect(saveBottle(db, anna, 1, bottle(), justBefore)).toBe('saved');
		expect(() => saveBottle(db, anna, 1, bottle({ distillery: 'Other' }), ORDER)).toThrow(
			TastingValidationError
		);
		expect(db.select().from(schema.tastingBottle).get()?.distillery).toBe('Ardbeg');
	});

	it.each([0, 3, 1.5, NaN])('refuses slot %s outside 1..bottlesPerParticipant', (slot) => {
		const { anna } = setup();
		expect(() => saveBottle(db, anna, slot, bottle(), ENTRY)).toThrow(
			expect.objectContaining({
				name: 'TastingValidationError',
				userMessage: 'Diese Flasche gibt es in diesem Tasting nicht.'
			})
		);
	});
});

describe('getParticipantView', () => {
	function fill(ctx: ReturnType<typeof setup>) {
		saveBottle(db, ctx.anna, 1, bottle({ alias: 'Nebel', distillery: 'Ardbeg' }), ENTRY);
		saveBottle(
			db,
			ctx.ben,
			1,
			bottle({ alias: 'Blume', distillery: 'Glenkinchie', smoke: 0, cask: 1, abv: 43 }),
			ENTRY
		);
	}

	it('shows only the holder’s own bottles during entry', () => {
		const ctx = setup();
		fill(ctx);
		const view = getParticipantView(db, ctx.anna, ENTRY);
		expect(view).toMatchObject({
			phase: 'entry',
			participant: { name: 'Anna' },
			tasting: { bottlesPerParticipant: 2 }
		});
		const serialized = JSON.stringify(view);
		expect(serialized).toContain('Nebel');
		expect(serialized).not.toContain('Blume');
		expect(serialized).not.toContain('Glenkinchie');
		expect(serialized).not.toContain('Ben');
	});

	it('shows only position and alias from 18:00', () => {
		const ctx = setup();
		fill(ctx);
		const view = getParticipantView(db, ctx.anna, ORDER);
		expect(view).toEqual({
			phase: 'order',
			tasting: { name: 'Herbst-Tasting', tastingDate: TASTING_DATE },
			order: [
				{ position: 1, alias: 'Blume' },
				{ position: 2, alias: 'Nebel' }
			]
		});
	});

	it('reveals all bottles with bringer and score, but no breakdown', () => {
		const ctx = setup();
		fill(ctx);
		const view = getParticipantView(db, ctx.cem, REVEALED);
		expect(view.phase).toBe('revealed');
		if (view.phase !== 'revealed') return;
		expect(view.bottles.map((b) => [b.position, b.alias, b.broughtBy])).toEqual([
			[1, 'Blume', 'Ben'],
			[2, 'Nebel', 'Anna']
		]);
		expect(view.bottles[1]).toMatchObject({
			distillery: 'Ardbeg',
			bottling: 'Uigeadail',
			whiskybaseUrl: 'https://www.whiskybase.com/whiskies/whisky/1',
			score: expect.any(Number)
		});
		expect(view.bottles[1]).not.toHaveProperty('breakdown');
	});
});

describe('getAdminTastingDetail', () => {
	function fill(ctx: ReturnType<typeof setup>) {
		saveBottle(db, ctx.anna, 1, bottle({ alias: 'Nebel', distillery: 'Ardbeg' }), ENTRY);
		saveBottle(db, ctx.anna, 2, bottle({ alias: 'Torf', distillery: 'Lagavulin' }), ENTRY);
	}

	it('returns null for an unknown tasting', () => {
		expect(getAdminTastingDetail(db, 'nope', ENTRY)).toBeNull();
	});

	it('shows only participants and progress during entry', () => {
		const ctx = setup();
		fill(ctx);
		const detail = getAdminTastingDetail(db, ctx.id, ENTRY)!;
		expect(detail.phase).toBe('entry');
		expect(detail.participants.map((p) => [p.name, p.progress])).toEqual([
			['Anna', { entered: 2, total: 2 }],
			['Ben', { entered: 0, total: 2 }],
			['Cem', { entered: 0, total: 2 }]
		]);
		const serialized = JSON.stringify(detail);
		for (const secret of ['Nebel', 'Torf', 'Ardbeg', 'Lagavulin', 'whiskybase']) {
			expect(serialized).not.toContain(secret);
		}
		for (const t of ctx.tokens) {
			expect(serialized).not.toContain(t.token);
			expect(serialized).not.toContain(hashTastingToken(t.token));
		}
	});

	it('shows the same order as the participants from 18:00', () => {
		const ctx = setup();
		fill(ctx);
		const detail = getAdminTastingDetail(db, ctx.id, ORDER)!;
		const participantView = getParticipantView(db, ctx.ben, ORDER);
		// Same values except the name → the display name breaks the tie.
		const expected = [
			{ position: 1, alias: 'Nebel' },
			{ position: 2, alias: 'Torf' }
		];
		expect(detail.phase === 'order' && detail.order).toEqual(expected);
		expect(participantView.phase === 'order' && participantView.order).toEqual(expected);
		const serialized = JSON.stringify(detail);
		expect(serialized).not.toContain('Ardbeg');
		expect(serialized).not.toContain('whiskybase');
	});

	it('adds the score breakdown after the reveal', () => {
		const ctx = setup();
		fill(ctx);
		const detail = getAdminTastingDetail(db, ctx.id, REVEALED)!;
		expect(detail.phase).toBe('revealed');
		if (detail.phase !== 'revealed') return;
		expect(detail.bottles[0]).toMatchObject({
			broughtBy: 'Anna',
			breakdown: { smoke: 40, cask: expect.any(Number), abv: expect.any(Number), value: 8 }
		});
	});
});

describe('listTastings and getStartPageSummary', () => {
	it('lists management data with phase and progress, newest date first', () => {
		const later = setup('2026-11-14');
		const earlier = setup(TASTING_DATE);
		saveBottle(db, earlier.anna, 1, bottle(), ENTRY);

		const list = listTastings(db, ENTRY);
		expect(list.map((t) => [t.id, t.phase, t.progress])).toEqual([
			[later.id, 'entry', { entered: 0, total: 6 }],
			[earlier.id, 'entry', { entered: 1, total: 6 }]
		]);
		expect(JSON.stringify(list)).not.toContain('Nebel');
	});

	it('counts and previews only unrevealed tastings, soonest first, flagging today', () => {
		setup('2026-10-10'); // revealed by REVEALED
		const today = setup('2026-10-25');
		const next = setup('2026-11-01');

		const summary = getStartPageSummary(db, REVEALED);
		expect(summary.upcomingCount).toBe(2);
		expect(summary.preview.map((t) => [t.id, t.isToday])).toEqual([
			[today.id, true],
			[next.id, false]
		]);
	});

	it('previews at most three tastings', () => {
		for (const day of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']) setup(day);
		const summary = getStartPageSummary(db, ENTRY);
		expect(summary.upcomingCount).toBe(4);
		expect(summary.preview).toHaveLength(3);
	});
});

describe('validateTastingDate', () => {
	// 22:30 UTC is already the next day in Berlin.
	const lateEvening = new Date('2026-10-20T22:30:00Z');

	it.each([
		{ raw: ' 2026-10-21 ', expected: { tastingDate: '2026-10-21', error: null } },
		{ raw: '', expected: { tastingDate: '', error: 'required' } },
		{ raw: '2026-02-30', expected: { tastingDate: '2026-02-30', error: 'invalid' } },
		{ raw: '2026-10-20', expected: { tastingDate: '2026-10-20', error: 'invalid' } }
	])('checks $raw against the Berlin date', ({ raw, expected }) => {
		expect(validateTastingDate(raw, lateEvening)).toEqual(expected);
	});
});

describe('updateTastingDate', () => {
	it('moves the tasting during entry', () => {
		const { id } = setup();
		expect(updateTastingDate(db, id, '2026-11-07', ENTRY)).toBe(true);
		expect(db.select().from(schema.tasting).get()?.tastingDate).toBe('2026-11-07');
	});

	it('returns false for an unknown tasting', () => {
		expect(updateTastingDate(db, 'nope', '2026-11-07', ENTRY)).toBe(false);
	});

	it('refuses once the entry phase is over', () => {
		const { id } = setup();
		expect(() => updateTastingDate(db, id, '2026-11-07', ORDER)).toThrow(TastingValidationError);
	});
});

describe('regenerateParticipantToken', () => {
	it('issues a new working token and keeps the bottles', () => {
		const { id, anna, tokens } = setup();
		saveBottle(db, anna, 1, bottle(), ENTRY);

		const issued = regenerateParticipantToken(db, id, anna.id)!;
		expect(issued).toMatchObject({ participantId: anna.id, name: 'Anna' });
		expect(issued.token).not.toBe(tokens[0].token);
		expect(findParticipantByToken(db, issued.token)?.id).toBe(anna.id);
		expect(db.select().from(schema.tastingBottle).all()).toHaveLength(1);
	});

	it('refuses a participant of another tasting', () => {
		const first = setup();
		const second = setup('2026-11-14');
		expect(regenerateParticipantToken(db, second.id, first.anna.id)).toBeNull();
	});
});

describe('deleteTasting', () => {
	it('cascades to participants, bottles and throttle rows', () => {
		const { id, anna } = setup();
		saveBottle(db, anna, 1, bottle(), ENTRY);
		db.insert(schema.tastingWriteThrottle)
			.values({ participantId: anna.id, count: 1, windowStart: ENTRY })
			.run();

		expect(deleteTasting(db, id)).toBe(true);
		expect(db.select().from(schema.tastingParticipant).all()).toEqual([]);
		expect(db.select().from(schema.tastingBottle).all()).toEqual([]);
		expect(db.select().from(schema.tastingWriteThrottle).all()).toEqual([]);
		expect(deleteTasting(db, id)).toBe(false);
	});
});
