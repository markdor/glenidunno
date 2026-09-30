import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { TastingBottle } from '$lib/tasting';
import * as schema from './db/schema';
import { presentationExtension } from './presentationFiles';
import type { PendingUpload } from './tastingMedia';
import { hashTastingToken } from './tastingToken';
import {
	createTasting,
	deleteTasting,
	findParticipantByToken,
	getAdminTastingDetail,
	getParticipantView,
	getPresentationForParticipant,
	getStartPageSummary,
	listPresentationFiles,
	listTastings,
	openOrderEarly,
	regenerateParticipantToken,
	revealEarly,
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
		expect(saveBottle(db, anna, 1, bottle(), ENTRY)).toMatchObject({ status: 'saved' });
		expect(saveBottle(db, anna, 1, bottle({ distillery: 'Laphroaig' }), ENTRY)).toMatchObject({
			status: 'saved'
		});

		const rows = db.select().from(schema.tastingBottle).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ participantId: anna.id, slot: 1, distillery: 'Laphroaig' });
	});

	it('rejects an alias used by someone else, ignoring case and umlaut case', () => {
		const { anna, ben } = setup();
		saveBottle(db, anna, 1, bottle({ alias: 'Ölfass' }), ENTRY);
		expect(saveBottle(db, ben, 1, bottle({ alias: 'ÖLFASS' }), ENTRY)).toEqual({
			status: 'alias-taken'
		});
		expect(saveBottle(db, ben, 1, bottle({ alias: 'ölfass' }), ENTRY)).toEqual({
			status: 'alias-taken'
		});
	});

	it('rejects an alias the holder already uses in another slot', () => {
		const { anna } = setup();
		saveBottle(db, anna, 1, bottle({ alias: 'Nebel' }), ENTRY);
		expect(saveBottle(db, anna, 2, bottle({ alias: 'nebel' }), ENTRY)).toEqual({
			status: 'alias-taken'
		});
	});

	it('lets the holder keep the alias of the bottle being updated', () => {
		const { anna } = setup();
		saveBottle(db, anna, 1, bottle({ alias: 'Nebel' }), ENTRY);
		expect(saveBottle(db, anna, 1, bottle({ alias: 'NEBEL' }), ENTRY)).toMatchObject({
			status: 'saved'
		});
	});

	it('refuses to save from 18:00 on the tasting day', () => {
		const { anna } = setup();
		const justBefore = new Date(ORDER.getTime() - 1000);
		expect(saveBottle(db, anna, 1, bottle(), justBefore)).toMatchObject({ status: 'saved' });
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

	it('shows only position, alias and the anonymous factor curves from 18:00', () => {
		const ctx = setup();
		fill(ctx);
		const view = getParticipantView(db, ctx.anna, ORDER);
		expect(view).toEqual({
			phase: 'order',
			tasting: { name: 'Herbst-Tasting', tastingDate: TASTING_DATE },
			manual: { orderOpenedAt: null, revealedAt: null },
			order: [
				{ position: 1, alias: 'Blume' },
				{ position: 2, alias: 'Nebel' }
			],
			// Blume, then Nebel – sorted by value, not in the factor order
			// smoke, cask, abv, value.
			curves: [
				[0, 1],
				[expect.closeTo(0.075), expect.closeTo(0.46)],
				[0.2, 0.6],
				[0.8, 0.8]
			]
		});
	});

	it('sends no factor names along with the curves', () => {
		const ctx = setup();
		fill(ctx);
		const serialized = JSON.stringify(getParticipantView(db, ctx.anna, ORDER));
		for (const hidden of ['smoke', 'cask', 'abv', 'value', 'score', 'Ardbeg', 'Anna', 'Ben']) {
			expect(serialized).not.toContain(hidden);
		}
	});

	it('sends empty curves when nobody entered a bottle', () => {
		const ctx = setup();
		expect(getParticipantView(db, ctx.anna, ORDER)).toMatchObject({
			order: [],
			curves: [[], [], [], []]
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

	it.each([
		{ phase: 'order', now: ORDER },
		{ phase: 'revealed', now: REVEALED }
	])('shows no bottle content in phase $phase either', ({ phase, now }) => {
		const ctx = setup();
		fill(ctx);
		const detail = getAdminTastingDetail(db, ctx.id, now)!;
		expect(detail.phase).toBe(phase);
		expect(Object.keys(detail).sort()).toEqual(['manual', 'participants', 'phase', 'tasting']);
		const serialized = JSON.stringify(detail);
		for (const secret of ['Nebel', 'Torf', 'Ardbeg', 'Lagavulin', 'whiskybase']) {
			expect(serialized).not.toContain(secret);
		}
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
		expect(updateTastingDate(db, id, '2026-11-07', ENTRY)).toEqual([]);
		expect(db.select().from(schema.tasting).get()?.tastingDate).toBe('2026-11-07');
	});

	it('returns null for an unknown tasting', () => {
		expect(updateTastingDate(db, 'nope', '2026-11-07', ENTRY)).toBeNull();
	});

	it('refuses once the entry phase is over', () => {
		const { id } = setup();
		expect(() => updateTastingDate(db, id, '2026-11-07', ORDER)).toThrow(TastingValidationError);
	});
});

describe('openOrderEarly and revealEarly (admin buttons)', () => {
	// Drizzle stores timestamps in whole seconds.
	const PRESSED = new Date('2026-10-22T15:32:10Z');

	it('opens the order ahead of 18:00 and tells every link when', () => {
		const ctx = setup();
		saveBottle(db, ctx.anna, 1, bottle(), ENTRY);

		expect(openOrderEarly(db, ctx.id, PRESSED)).toBe(true);

		const holder = findParticipantByToken(db, ctx.tokens[1].token)!;
		const view = getParticipantView(db, holder, PRESSED);
		expect(view).toMatchObject({
			phase: 'order',
			manual: { orderOpenedAt: PRESSED, revealedAt: null },
			order: [{ position: 1, alias: 'Nebel' }]
		});
		expect(getAdminTastingDetail(db, ctx.id, PRESSED)).toMatchObject({
			phase: 'order',
			manual: { orderOpenedAt: PRESSED }
		});
	});

	it('closes the entry at once', () => {
		const ctx = setup();
		openOrderEarly(db, ctx.id, PRESSED);
		expect(() => saveBottle(db, ctx.anna, 1, bottle(), PRESSED)).toThrow(TastingValidationError);
		expect(() => updateTastingDate(db, ctx.id, '2026-11-07', PRESSED)).toThrow(
			TastingValidationError
		);
	});

	it('refuses to open the order twice or after 18:00', () => {
		const ctx = setup();
		expect(() => openOrderEarly(db, ctx.id, ORDER)).toThrow(
			expect.objectContaining({ userMessage: 'Die Reihenfolge ist bereits freigegeben.' })
		);
		openOrderEarly(db, ctx.id, PRESSED);
		expect(() => openOrderEarly(db, ctx.id, PRESSED)).toThrow(TastingValidationError);
	});

	it('reveals ahead of 9:00 once the order is out', () => {
		const ctx = setup();
		saveBottle(db, ctx.anna, 1, bottle(), ENTRY);
		const REVEAL_PRESSED = new Date('2026-10-22T16:05:00Z');

		openOrderEarly(db, ctx.id, PRESSED);
		expect(revealEarly(db, ctx.id, REVEAL_PRESSED)).toBe(true);

		const holder = findParticipantByToken(db, ctx.tokens[2].token)!;
		expect(getParticipantView(db, holder, REVEAL_PRESSED)).toMatchObject({
			phase: 'revealed',
			manual: { orderOpenedAt: PRESSED, revealedAt: REVEAL_PRESSED },
			bottles: [{ alias: 'Nebel', distillery: 'Ardbeg', broughtBy: 'Anna' }]
		});
		// Revealed tastings no longer count as upcoming.
		expect(getStartPageSummary(db, REVEAL_PRESSED).upcomingCount).toBe(0);
		expect(listTastings(db, REVEAL_PRESSED)[0].phase).toBe('revealed');
	});

	it('also reveals when the order came out by the clock at 18:00', () => {
		const ctx = setup();
		expect(revealEarly(db, ctx.id, ORDER)).toBe(true);
		expect(getAdminTastingDetail(db, ctx.id, ORDER)).toMatchObject({
			phase: 'revealed',
			manual: { orderOpenedAt: null, revealedAt: ORDER }
		});
	});

	it('refuses to skip the order and reveal straight from the entry phase', () => {
		const ctx = setup();
		expect(() => revealEarly(db, ctx.id, PRESSED)).toThrow(
			expect.objectContaining({ userMessage: 'Gib zuerst die Reihenfolge frei.' })
		);
		expect(getAdminTastingDetail(db, ctx.id, PRESSED)).toMatchObject({
			phase: 'entry',
			manual: { revealedAt: null }
		});
	});

	it('refuses to reveal twice or after 9:00 on the next day', () => {
		const ctx = setup();
		expect(() => revealEarly(db, ctx.id, REVEALED)).toThrow(
			expect.objectContaining({ userMessage: 'Das Tasting ist bereits aufgelöst.' })
		);
		revealEarly(db, ctx.id, ORDER);
		expect(() => revealEarly(db, ctx.id, ORDER)).toThrow(TastingValidationError);
	});

	it('returns false for an unknown tasting', () => {
		expect(openOrderEarly(db, 'nope', PRESSED)).toBe(false);
		expect(revealEarly(db, 'nope', PRESSED)).toBe(false);
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

describe('presentations', () => {
	// A staged upload as tastingMedia.stageUpload() returns it.
	function upload(name: string, tempFile = '.upload-1'): PendingUpload {
		return { tempFile, name, extension: presentationExtension(name) };
	}
	const DECK = upload('Ardbeg-Uigeadail.pptx');
	// bottle() uses the alias "Nebel", the tasting is on 24.10.2026.
	const DECK_FILE = 'Tasting_2026-10-24_Nebel.pptx';

	function bottleRow() {
		return db.select().from(schema.tastingBottle).get()!;
	}

	function saved(fileChanges: unknown[]) {
		return { status: 'saved', fileChanges };
	}

	it('names the file after tasting date and alias and keeps it in sync', () => {
		const { anna } = setup();

		// A new upload moves from its temporary file to the scheme's name.
		expect(saveBottle(db, anna, 1, bottle(), ENTRY, DECK)).toEqual(
			saved([{ move: '.upload-1', to: DECK_FILE }])
		);
		expect(bottleRow()).toMatchObject({ presentationFile: DECK_FILE, presentationName: DECK.name });

		// Saving without touching alias or presentation changes nothing on disk.
		expect(saveBottle(db, anna, 1, bottle({ distillery: 'Laphroaig' }), ENTRY)).toEqual(saved([]));

		// A new alias renames the kept file.
		const renamed = 'Tasting_2026-10-24_Blaue_Stunde.pptx';
		expect(saveBottle(db, anna, 1, bottle({ alias: 'Blaue Stunde' }), ENTRY)).toEqual(
			saved([{ move: DECK_FILE, to: renamed }])
		);
		expect(bottleRow()).toMatchObject({ presentationFile: renamed, presentationName: DECK.name });

		// A re-upload under the same name simply replaces the file ...
		expect(
			saveBottle(
				db,
				anna,
				1,
				bottle({ alias: 'Blaue Stunde' }),
				ENTRY,
				upload('v2.pptx', '.upload-2')
			)
		).toEqual(saved([{ move: '.upload-2', to: renamed }]));

		// ... one with another extension leaves the old file behind for deletion.
		expect(
			saveBottle(
				db,
				anna,
				1,
				bottle({ alias: 'Blaue Stunde' }),
				ENTRY,
				upload('v3.pdf', '.upload-3')
			)
		).toEqual(
			saved([{ move: '.upload-3', to: 'Tasting_2026-10-24_Blaue_Stunde.pdf' }, { delete: renamed }])
		);

		// null removes it.
		expect(saveBottle(db, anna, 1, bottle({ alias: 'Blaue Stunde' }), ENTRY, null)).toEqual(
			saved([{ delete: 'Tasting_2026-10-24_Blaue_Stunde.pdf' }])
		);
		expect(bottleRow()).toMatchObject({ presentationFile: null, presentationName: null });
		expect(saveBottle(db, anna, 1, bottle({ alias: 'Blaue Stunde' }), ENTRY, null)).toEqual(
			saved([])
		);
	});

	it('counts up when another tasting on the same day uses the same alias', () => {
		const first = setup();
		const second = setup();
		saveBottle(db, first.anna, 1, bottle({ alias: 'Nebel' }), ENTRY, DECK);

		expect(saveBottle(db, second.anna, 1, bottle({ alias: 'NEBEL' }), ENTRY, DECK)).toEqual(
			saved([{ move: '.upload-1', to: 'Tasting_2026-10-24_NEBEL_2.pptx' }])
		);
	});

	it('renames the files along with a new tasting date', () => {
		const ctx = setup();
		const sameDay = setup();
		saveBottle(db, ctx.anna, 1, bottle({ alias: 'Nebel' }), ENTRY, DECK);
		saveBottle(db, ctx.ben, 1, bottle({ alias: 'Blume' }), ENTRY, upload('b.pdf'));
		saveBottle(db, ctx.cem, 1, bottle({ alias: 'Torf' }), ENTRY);
		// Another tasting on the new date already uses "Nebel".
		updateTastingDate(db, sameDay.id, '2026-11-07', ENTRY);
		saveBottle(db, sameDay.anna, 1, bottle({ alias: 'Nebel' }), ENTRY, DECK);

		const changes = updateTastingDate(db, ctx.id, '2026-11-07', ENTRY);

		expect(changes).toEqual(
			expect.arrayContaining([
				{ move: 'Tasting_2026-10-24_Nebel.pptx', to: 'Tasting_2026-11-07_Nebel_2.pptx' },
				{ move: 'Tasting_2026-10-24_Blume.pdf', to: 'Tasting_2026-11-07_Blume.pdf' }
			])
		);
		expect(changes).toHaveLength(2);
		expect(listPresentationFiles(db, ctx.id).sort()).toEqual([
			'Tasting_2026-11-07_Blume.pdf',
			'Tasting_2026-11-07_Nebel_2.pptx'
		]);
		// The same date again: nothing to rename.
		expect(updateTastingDate(db, ctx.id, '2026-11-07', ENTRY)).toEqual([]);
	});

	it('leaves the presentation untouched when the alias is taken', () => {
		const { anna, ben } = setup();
		saveBottle(db, anna, 1, bottle({ alias: 'Nebel' }), ENTRY);
		expect(saveBottle(db, ben, 1, bottle({ alias: 'Nebel' }), ENTRY, DECK)).toEqual({
			status: 'alias-taken'
		});
		expect(
			db
				.select()
				.from(schema.tastingBottle)
				.all()
				.map((b) => b.presentationFile)
		).toEqual([null]);
	});

	it('shows the name only to its owner before the reveal and to every link after it', () => {
		const ctx = setup();
		saveBottle(db, ctx.anna, 1, bottle(), ENTRY, DECK);

		const own = getParticipantView(db, ctx.anna, ENTRY);
		expect(own.phase === 'entry' && own.bottles[0].presentationName).toBe(DECK.name);
		expect(JSON.stringify(getParticipantView(db, ctx.ben, ENTRY))).not.toContain('Uigeadail');

		const participantOrder = JSON.stringify(getParticipantView(db, ctx.ben, ORDER));
		expect(participantOrder).not.toContain('Uigeadail');
		expect(participantOrder).not.toContain(DECK_FILE);

		// The admin page carries no content at all, not even after the reveal.
		for (const now of [ENTRY, ORDER, REVEALED]) {
			const admin = JSON.stringify(getAdminTastingDetail(db, ctx.id, now));
			expect(admin).not.toContain('Uigeadail');
			expect(admin).not.toContain(DECK.name);
			expect(admin).not.toContain(DECK_FILE);
		}

		const revealed = getParticipantView(db, ctx.ben, REVEALED);
		const bottleId = bottleRow().id;
		expect(revealed.phase === 'revealed' && revealed.bottles[0].presentation).toEqual({
			bottleId,
			name: DECK.name
		});
		// The stored file name never leaves the server.
		expect(JSON.stringify(revealed)).not.toContain(DECK_FILE);
	});

	it('hands out the file only after the reveal and only within the tasting', () => {
		const ctx = setup();
		const other = setup('2026-11-14');
		saveBottle(db, ctx.anna, 1, bottle(), ENTRY, DECK);
		const bottleId = bottleRow().id;

		for (const now of [ENTRY, ORDER]) {
			// Not even the owner: the name counts as content, the download is for the reveal.
			expect(getPresentationForParticipant(db, ctx.anna, bottleId, now)).toBeNull();
			expect(getPresentationForParticipant(db, ctx.ben, bottleId, now)).toBeNull();
		}

		const stored = { file: DECK_FILE, name: DECK.name };
		expect(getPresentationForParticipant(db, ctx.ben, bottleId, REVEALED)).toEqual(stored);

		// Other tastings, unknown bottles and bottles without presentation: null.
		expect(getPresentationForParticipant(db, other.anna, bottleId, REVEALED)).toBeNull();
		expect(getPresentationForParticipant(db, ctx.ben, 'nope', REVEALED)).toBeNull();
		saveBottle(db, ctx.ben, 1, bottle({ alias: 'Blume' }), ENTRY);
		const withoutDeck = db
			.select()
			.from(schema.tastingBottle)
			.all()
			.find((b) => b.alias === 'Blume')!;
		expect(getPresentationForParticipant(db, ctx.anna, withoutDeck.id, REVEALED)).toBeNull();
	});

	it('lists the stored files of a tasting for the cleanup after deleting it', () => {
		const ctx = setup();
		const other = setup('2026-11-14');
		saveBottle(db, ctx.anna, 1, bottle(), ENTRY, DECK);
		saveBottle(db, ctx.ben, 1, bottle({ alias: 'Blume' }), ENTRY, upload('Neu.pdf'));
		saveBottle(db, ctx.cem, 1, bottle({ alias: 'Torf' }), ENTRY);
		saveBottle(db, other.anna, 1, bottle({ alias: 'Fremd' }), ENTRY, upload('x'));

		expect(listPresentationFiles(db, ctx.id).sort()).toEqual([
			'Tasting_2026-10-24_Blume.pdf',
			DECK_FILE
		]);
	});
});
