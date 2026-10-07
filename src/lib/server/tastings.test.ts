import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, ne } from 'drizzle-orm';
import type { TastingBottle } from '$lib/tasting';
import { TASTING_SLUG_RE } from '$lib/validation';
import { runMigrations } from './db/migrate';
import * as schema from './db/schema';
import { presentationExtension } from './presentationFiles';
import type { PendingUpload } from './tastingMedia';
import {
	createTasting,
	deleteTasting,
	findParticipant,
	getAdminTastingDetail,
	getParticipantView,
	getPresentationForParticipant,
	getStartPageSummary,
	listPresentationFiles,
	listSelectableUsers,
	listTastings,
	openOrderEarly,
	revealEarly,
	saveBottle,
	TastingValidationError,
	updateTastingDate,
	validateTastingDate,
	type NewTasting
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

const PARTICIPANT_IDS = ['u-anna', 'u-ben', 'u-cem'];

function insertUser(id: string, username: string, deactivatedAt: Date | null = null) {
	db.insert(schema.user)
		.values({
			id,
			name: username,
			email: `${username.toLowerCase()}@example.com`,
			username,
			deactivatedAt,
			createdAt: ENTRY,
			updatedAt: ENTRY
		})
		.run();
}

function newTasting(overrides: Partial<NewTasting> = {}): NewTasting {
	return {
		name: 'Herbst-Tasting',
		tastingDate: TASTING_DATE,
		bottlesPerParticipant: 2,
		participantUserIds: PARTICIPANT_IDS,
		...overrides
	};
}

function setup(tastingDate = TASTING_DATE) {
	const { id, slug } = createTasting(db, newTasting({ tastingDate }), ENTRY);
	const [anna, ben, cem] = PARTICIPANT_IDS.map((userId) => findParticipant(db, slug, userId)!);
	return { id, slug, anna, ben, cem };
}

beforeEach(() => {
	const sqlite = new Database(':memory:');
	runMigrations(sqlite, './drizzle');
	db = drizzle(sqlite, { schema });
	insertUser('u-anna', 'Anna');
	insertUser('u-ben', 'Ben');
	insertUser('u-cem', 'Cem');
	// Takes part in nothing – like the admin, who manages without tasting along.
	insertUser('u-admin', 'Markus');
});

describe('createTasting', () => {
	it('adds the users as participants in the given order, under a slug from the word lists', () => {
		const { id, slug } = createTasting(db, newTasting(), ENTRY);

		expect(slug).toMatch(TASTING_SLUG_RE);
		const [adjective, animal] = slug.split('-');
		expect(
			db
				.select()
				.from(schema.tastingSlugAdjective)
				.where(eq(schema.tastingSlugAdjective.word, adjective))
				.get()
		).toBeDefined();
		expect(
			db
				.select()
				.from(schema.tastingSlugAnimal)
				.where(eq(schema.tastingSlugAnimal.word, animal))
				.get()
		).toBeDefined();
		expect(db.select().from(schema.tasting).get()).toMatchObject({ id, slug });
		expect(getAdminTastingDetail(db, id, ENTRY)?.participants.map((p) => p.name)).toEqual([
			'Anna',
			'Ben',
			'Cem'
		]);
	});

	it('picks the slug among the combinations no other tasting uses', () => {
		const maxima: number[] = [];
		const first = (max: number) => {
			maxima.push(max);
			return 0;
		};

		expect(createTasting(db, newTasting(), ENTRY, first).slug).toBe('bouncy-alpaca');
		expect(createTasting(db, newTasting(), ENTRY, first).slug).toBe('bouncy-axolotl');
		expect(maxima).toEqual([10_000, 9_999]);
	});

	it('refuses once every combination is taken', () => {
		db.delete(schema.tastingSlugAdjective)
			.where(ne(schema.tastingSlugAdjective.word, 'fluffy'))
			.run();
		db.delete(schema.tastingSlugAnimal).where(ne(schema.tastingSlugAnimal.word, 'otter')).run();
		expect(createTasting(db, newTasting(), ENTRY).slug).toBe('fluffy-otter');

		expect(() => createTasting(db, newTasting(), ENTRY)).toThrow(
			expect.objectContaining({
				name: 'TastingValidationError',
				userMessage:
					'Alle Tasting-Links sind vergeben, es lässt sich kein weiteres Tasting anlegen.'
			})
		);
		expect(db.select().from(schema.tasting).all()).toHaveLength(1);
	});

	it.each([
		{ label: 'an unknown user', userId: 'u-nobody' },
		{ label: 'a deactivated user', userId: 'u-gone' }
	])('refuses $label and creates nothing', ({ userId }) => {
		insertUser('u-gone', 'Gone', ENTRY);

		expect(() =>
			createTasting(db, newTasting({ participantUserIds: ['u-anna', userId] }), ENTRY)
		).toThrow(TastingValidationError);
		expect(db.select().from(schema.tasting).all()).toEqual([]);
		expect(db.select().from(schema.tastingParticipant).all()).toEqual([]);
	});

	it('adds a user picked twice only once', () => {
		const { id } = createTasting(
			db,
			newTasting({ participantUserIds: ['u-anna', 'u-ben', 'u-anna'] }),
			ENTRY
		);
		expect(getAdminTastingDetail(db, id, ENTRY)?.participants).toHaveLength(2);
	});
});

describe('listSelectableUsers', () => {
	it('lists the active users alphabetically, without deactivated ones', () => {
		insertUser('u-dora', 'dora');
		insertUser('u-gone', 'Gone', ENTRY);
		expect(listSelectableUsers(db)).toEqual([
			{ id: 'u-anna', username: 'Anna' },
			{ id: 'u-ben', username: 'Ben' },
			{ id: 'u-cem', username: 'Cem' },
			{ id: 'u-dora', username: 'dora' },
			{ id: 'u-admin', username: 'Markus' }
		]);
	});
});

describe('findParticipant', () => {
	it('finds the user’s participation in the tasting behind the slug', () => {
		const { id, slug, anna } = setup();
		expect(anna).toMatchObject({
			username: 'Anna',
			tastingId: id,
			tastingName: 'Herbst-Tasting',
			tastingDate: TASTING_DATE,
			bottlesPerParticipant: 2,
			orderOpenedAt: null,
			revealedAt: null
		});
		expect(findParticipant(db, slug, 'u-anna')?.id).toBe(anna.id);
	});

	it('returns null for an unknown slug, a user who doesn’t take part and a deleted tasting', () => {
		const { id, slug } = setup();
		const other = setup('2026-11-14');

		expect(findParticipant(db, 'fluffy-nothing', 'u-anna')).toBeNull();
		// The admin manages the tasting, but doesn't take part in it.
		expect(findParticipant(db, slug, 'u-admin')).toBeNull();
		expect(findParticipant(db, other.slug, 'u-admin')).toBeNull();

		deleteTasting(db, id);
		expect(findParticipant(db, slug, 'u-anna')).toBeNull();
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
			participant: { username: 'Anna' },
			tasting: { bottlesPerParticipant: 2 }
		});
		const serialized = JSON.stringify(view);
		expect(serialized).toContain('Nebel');
		expect(serialized).not.toContain('Blume');
		expect(serialized).not.toContain('Glenkinchie');
		expect(serialized).not.toContain('Ben');
	});

	it('shows only position, alias and total score from 18:00', () => {
		const ctx = setup();
		fill(ctx);
		const view = getParticipantView(db, ctx.anna, ORDER);
		expect(view).toEqual({
			phase: 'order',
			tasting: { name: 'Herbst-Tasting', tastingDate: TASTING_DATE },
			manual: { orderOpenedAt: null, revealedAt: null },
			order: [
				{ position: 1, alias: 'Blume', score: 22.8, presentation: null },
				{ position: 2, alias: 'Nebel', score: 78.6, presentation: null }
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

	it('marks the bringer of a bottle as inactive once deactivated', () => {
		const ctx = setup();
		fill(ctx);
		db.update(schema.user).set({ deactivatedAt: ORDER }).where(eq(schema.user.id, 'u-ben')).run();

		const view = getParticipantView(db, ctx.anna, REVEALED);
		expect(view.phase === 'revealed' && view.bottles.map((b) => b.broughtBy)).toEqual([
			'Ben (inaktiv)',
			'Anna'
		]);
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
	});

	it('marks deactivated participants', () => {
		const ctx = setup();
		db.update(schema.user).set({ deactivatedAt: ENTRY }).where(eq(schema.user.id, 'u-cem')).run();
		expect(getAdminTastingDetail(db, ctx.id, ENTRY)?.participants.map((p) => p.name)).toEqual([
			'Anna',
			'Ben',
			'Cem (inaktiv)'
		]);
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

	it('opens the order ahead of 18:00 and tells every participant when', () => {
		const ctx = setup();
		saveBottle(db, ctx.anna, 1, bottle(), ENTRY);

		expect(openOrderEarly(db, ctx.id, PRESSED)).toBe(true);

		const holder = findParticipant(db, ctx.slug, 'u-ben')!;
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

		const holder = findParticipant(db, ctx.slug, 'u-cem')!;
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

	it('links it from the order on, but shows the name only to its owner before the reveal', () => {
		const ctx = setup();
		saveBottle(db, ctx.anna, 1, bottle(), ENTRY, DECK);
		const bottleId = bottleRow().id;

		const own = getParticipantView(db, ctx.anna, ENTRY);
		expect(own.phase === 'entry' && own.bottles[0].presentationName).toBe(DECK.name);
		expect(JSON.stringify(getParticipantView(db, ctx.ben, ENTRY))).not.toContain('Uigeadail');

		// The slides are shown during the tasting: linked, but under no name yet.
		const order = getParticipantView(db, ctx.ben, ORDER);
		expect(order.phase === 'order' && order.order[0].presentation).toEqual({ bottleId });
		const participantOrder = JSON.stringify(order);
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
		expect(revealed.phase === 'revealed' && revealed.bottles[0].presentation).toEqual({
			bottleId,
			name: DECK.name
		});
		// The view never carries the stored file name (only the download before the reveal).
		expect(JSON.stringify(revealed)).not.toContain(DECK_FILE);
	});

	it('hands out the file from the order on and only within the tasting', () => {
		const ctx = setup();
		const other = setup('2026-11-14');
		saveBottle(db, ctx.anna, 1, bottle(), ENTRY, DECK);
		const bottleId = bottleRow().id;

		// Not even the owner during entry: the bottles are still being entered.
		expect(getPresentationForParticipant(db, ctx.anna, bottleId, ENTRY)).toBeNull();
		expect(getPresentationForParticipant(db, ctx.ben, bottleId, ENTRY)).toBeNull();

		// Until the reveal under the stored name: the original one may reveal the whisky.
		expect(getPresentationForParticipant(db, ctx.ben, bottleId, ORDER)).toEqual({
			file: DECK_FILE,
			name: DECK_FILE
		});
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
