import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, ne } from 'drizzle-orm';
import type { TastingBottle } from '$lib/tasting';
import {
	TASTING_MOTTO_DESCRIPTION_LENGTH,
	TASTING_MOTTO_LENGTH,
	TASTING_SLUG_RE
} from '$lib/validation';
import { runMigrations } from './db/migrate';
import * as schema from './db/schema';
import { presentationExtension } from './presentationFiles';
import type { PendingUpload } from './tastingMedia';
import {
	createTasting,
	deleteTasting,
	findParticipant,
	getAdminTastingDetail,
	getDashboardTasting,
	getHistory,
	getParticipantView,
	getPresentationForParticipant,
	getStartPageSummary,
	getStatistics,
	getWorldMap,
	listPresentationFiles,
	listSelectableUsers,
	listTastings,
	openOrderEarly,
	removeBottle,
	revealEarly,
	saveBottle,
	TastingValidationError,
	updateTastingDate,
	updateTastingMotto,
	validateTastingDate,
	validateTastingMotto,
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
		participantUserIds: PARTICIPANT_IDS,
		...overrides
	};
}

function setup(tastingDate = TASTING_DATE) {
	const { id, slug } = createTasting(db, newTasting({ tastingDate }), ENTRY);
	const [anna, ben, cem] = PARTICIPANT_IDS.map((userId) => findParticipant(db, slug, userId)!);
	return { id, slug, anna, ben, cem };
}

/** An archived bottle as the history import writes it – the app has no way to. */
function insertArchivedBottle(
	participantId: string,
	slot: number,
	alias: string,
	overrides: Partial<typeof schema.tastingBottle.$inferInsert> = {}
) {
	db.insert(schema.tastingBottle)
		.values({
			id: `b-${alias}`,
			participantId,
			slot,
			alias,
			distillery: 'Aberlour',
			abv: 40,
			archived: true,
			updatedAt: ENTRY,
			...overrides
		})
		.run();
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

	it('stores heading and description of the motto, none if left out', () => {
		const withMotto = createTasting(
			db,
			newTasting({ motto: 'Inselhüpfen', mottoDescription: 'Bringt Inseln mit.\nKeine Blends.' }),
			ENTRY
		);
		const without = createTasting(db, newTasting(), ENTRY);
		const motto = (id: string) => {
			const t = getAdminTastingDetail(db, id, ENTRY)?.tasting;
			return { motto: t?.motto, mottoDescription: t?.mottoDescription };
		};
		expect(motto(withMotto.id)).toEqual({
			motto: 'Inselhüpfen',
			mottoDescription: 'Bringt Inseln mit.\nKeine Blends.'
		});
		expect(motto(without.id)).toEqual({ motto: null, mottoDescription: null });
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
			tastingMotto: null,
			tastingMottoDescription: null,
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

	it('takes the slots up to 6 in every tasting', () => {
		const { anna } = setup();
		for (const slot of [3, 4, 5, 6]) {
			expect(saveBottle(db, anna, slot, bottle({ alias: `Flasche ${slot}` }), ENTRY)).toMatchObject(
				{ status: 'saved' }
			);
		}
		expect(
			db
				.select({ slot: schema.tastingBottle.slot })
				.from(schema.tastingBottle)
				.all()
				.map((b) => b.slot)
				.sort()
		).toEqual([3, 4, 5, 6]);
	});

	it.each([0, 7, 1.5, NaN])('refuses slot %s outside 1..6', (slot) => {
		const { anna } = setup();
		expect(() => saveBottle(db, anna, slot, bottle(), ENTRY)).toThrow(
			expect.objectContaining({
				name: 'TastingValidationError',
				userMessage: 'Diese Flasche gibt es in diesem Tasting nicht.'
			})
		);
	});

	it('refuses to save into a tasting with an archived bottle and changes nothing', () => {
		const { id, anna, ben } = setup();
		saveBottle(db, anna, 1, bottle(), ENTRY);
		insertArchivedBottle(ben.id, 1, 'Moor');
		const before = db.select().from(schema.tastingBottle).all();

		for (const slot of [1, 2]) {
			expect(() =>
				saveBottle(db, anna, slot, bottle({ alias: 'Neu', distillery: 'Other' }), ENTRY)
			).toThrow(
				expect.objectContaining({
					name: 'TastingValidationError',
					message: `save rejected: tasting ${id} has archived bottles`,
					userMessage: 'Die Eingabe ist geschlossen, deine Änderung wurde nicht gespeichert.'
				})
			);
		}
		expect(db.select().from(schema.tastingBottle).all()).toEqual(before);
	});
});

describe('removeBottle', () => {
	// A staged upload as tastingMedia.stageUpload() returns it.
	const DECK: PendingUpload = { tempFile: '.upload-1', name: 'Vortrag.pptx', extension: '.pptx' };
	// The tasting is on 24.10.2026.
	const TORF_FILE = 'Tasting_2026-10-24_Torf.pptx';

	function slotsOf(participantId: string) {
		return db
			.select({ slot: schema.tastingBottle.slot })
			.from(schema.tastingBottle)
			.where(eq(schema.tastingBottle.participantId, participantId))
			.all()
			.map((b) => b.slot)
			.sort();
	}

	it('removes a further bottle and hands back its presentation file for deletion', () => {
		const { anna } = setup();
		saveBottle(db, anna, 1, bottle({ alias: 'Nebel' }), ENTRY);
		saveBottle(db, anna, 3, bottle({ alias: 'Torf' }), ENTRY, DECK);
		saveBottle(db, anna, 4, bottle({ alias: 'Rauch' }), ENTRY);

		expect(removeBottle(db, anna, 3, ENTRY)).toEqual([{ delete: TORF_FILE }]);
		expect(removeBottle(db, anna, 4, ENTRY)).toEqual([]);
		expect(slotsOf(anna.id)).toEqual([1]);
	});

	it('takes an empty slot as removed already', () => {
		const { anna } = setup();
		expect(removeBottle(db, anna, 5, ENTRY)).toEqual([]);
	});

	it('removes only the holder’s own bottle', () => {
		const { anna, ben } = setup();
		saveBottle(db, ben, 3, bottle({ alias: 'Torf' }), ENTRY, DECK);

		expect(removeBottle(db, anna, 3, ENTRY)).toEqual([]);
		expect(slotsOf(ben.id)).toEqual([3]);
	});

	it('frees the alias and the file name again', () => {
		const { anna, ben } = setup();
		saveBottle(db, anna, 3, bottle({ alias: 'Torf' }), ENTRY, DECK);
		removeBottle(db, anna, 3, ENTRY);

		expect(
			saveBottle(db, ben, 1, bottle({ alias: 'torf' }), ENTRY, { ...DECK, tempFile: '.upload-2' })
		).toEqual({
			status: 'saved',
			fileChanges: [{ move: '.upload-2', to: 'Tasting_2026-10-24_torf.pptx' }]
		});
		expect(saveBottle(db, anna, 3, bottle({ alias: 'Torf' }), ENTRY, DECK)).toEqual({
			status: 'alias-taken'
		});
	});

	it.each([1, 2, 0, 7, 1.5, NaN])('refuses to remove slot %s', (slot) => {
		const { anna } = setup();
		saveBottle(db, anna, 1, bottle({ alias: 'Nebel' }), ENTRY);
		saveBottle(db, anna, 2, bottle({ alias: 'Torf' }), ENTRY);

		expect(() => removeBottle(db, anna, slot, ENTRY)).toThrow(
			expect.objectContaining({
				name: 'TastingValidationError',
				userMessage: 'Diese Flasche lässt sich nicht entfernen.'
			})
		);
		expect(slotsOf(anna.id)).toEqual([1, 2]);
	});

	it('refuses from 18:00 on and once the admin opened the order', () => {
		const ctx = setup();
		saveBottle(db, ctx.anna, 3, bottle({ alias: 'Torf' }), ENTRY, DECK);
		const closed = expect.objectContaining({
			name: 'TastingValidationError',
			userMessage: 'Die Eingabe ist geschlossen, die Flasche wurde nicht entfernt.'
		});

		expect(() => removeBottle(db, ctx.anna, 3, ORDER)).toThrow(closed);
		openOrderEarly(db, ctx.id, ENTRY);
		expect(() => removeBottle(db, ctx.anna, 3, ENTRY)).toThrow(closed);
		expect(listPresentationFiles(db, ctx.id)).toEqual([TORF_FILE]);
	});

	it('refuses to remove from a tasting with an archived bottle, its own neither', () => {
		const ctx = setup();
		saveBottle(db, ctx.anna, 3, bottle({ alias: 'Torf' }), ENTRY, DECK);
		const moorFile = 'Tasting_2026-10-24_Moor.pptx';
		insertArchivedBottle(ctx.anna.id, 4, 'Moor', {
			presentationFile: moorFile,
			presentationName: 'Moor.pptx'
		});
		const before = db.select().from(schema.tastingBottle).all();

		for (const slot of [3, 4]) {
			expect(() => removeBottle(db, ctx.anna, slot, ENTRY)).toThrow(
				expect.objectContaining({
					name: 'TastingValidationError',
					message: `remove rejected: tasting ${ctx.id} has archived bottles`,
					userMessage: 'Die Eingabe ist geschlossen, die Flasche wurde nicht entfernt.'
				})
			);
		}
		expect(db.select().from(schema.tastingBottle).all()).toEqual(before);
		expect(listPresentationFiles(db, ctx.id).sort()).toEqual([moorFile, TORF_FILE]);
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
			tasting: { name: 'Herbst-Tasting', tastingDate: TASTING_DATE }
		});
		const serialized = JSON.stringify(view);
		expect(serialized).toContain('Nebel');
		expect(serialized).not.toContain('Blume');
		expect(serialized).not.toContain('Glenkinchie');
		expect(serialized).not.toContain('Ben');
	});

	it.each([
		{ phase: 'entry', now: ENTRY },
		{ phase: 'order', now: ORDER },
		{ phase: 'revealed', now: REVEALED }
	])('shows heading and description of the motto in phase $phase', ({ phase, now }) => {
		const ctx = setup();
		fill(ctx);
		const motto = { motto: 'Inselhüpfen', mottoDescription: 'Eine Insel pro Flasche.\nDanke!' };
		updateTastingMotto(db, ctx.id, motto);
		const holder = findParticipant(db, ctx.slug, 'u-anna')!;

		const view = getParticipantView(db, holder, now);
		expect(view.phase).toBe(phase);
		expect(view.tasting).toEqual({ name: 'Herbst-Tasting', tastingDate: TASTING_DATE, ...motto });
	});

	it('offers the distilleries of revealed tastings during entry: one spelling each, no placeholder', () => {
		const before = new Date('2026-10-01T10:00:00Z');
		const past = setup('2026-10-03');
		saveBottle(db, past.anna, 1, bottle({ alias: 'Alt', distillery: 'lagavulin' }), before);
		saveBottle(db, past.ben, 1, bottle({ alias: 'Älter', distillery: 'Lagavulin ' }), before);
		saveBottle(db, past.cem, 1, bottle({ alias: 'Mix', distillery: 'Blend' }), before);
		saveBottle(db, past.cem, 2, bottle({ alias: 'Insel', distillery: 'Bowmore' }), before);
		// Same day, 22:00: released for the research, but not revealed.
		const tonight = setup('2026-10-19');
		saveBottle(db, tonight.anna, 1, bottle({ alias: 'Heute', distillery: 'Talisker' }), before);
		const ctx = setup();
		fill(ctx);

		const view = getParticipantView(db, ctx.anna, new Date('2026-10-19T20:00:00Z'));

		expect(view).toMatchObject({ phase: 'entry', distilleryNames: ['Bowmore', 'lagavulin'] });
		const serialized = JSON.stringify(view);
		expect(serialized).not.toContain('Talisker');
		expect(serialized).not.toContain('Glenkinchie');
		expect(getParticipantView(db, past.anna, REVEALED)).not.toHaveProperty('distilleryNames');
	});

	it('shows only position, alias and total score from 18:00', () => {
		const ctx = setup();
		fill(ctx);
		const view = getParticipantView(db, ctx.anna, ORDER);
		expect(view).toEqual({
			phase: 'order',
			tasting: {
				name: 'Herbst-Tasting',
				tastingDate: TASTING_DATE,
				motto: null,
				mottoDescription: null
			},
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
		expect(view).toMatchObject({ phase: 'revealed', archived: false });
		if (view.phase !== 'revealed' || view.archived) return;
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

	it('pours and reveals the bottles from slots 3 to 6 as well', () => {
		const ctx = setup();
		fill(ctx);
		saveBottle(db, ctx.anna, 3, bottle({ alias: 'Torf', smoke: 4 }), ENTRY);
		saveBottle(db, ctx.anna, 6, bottle({ alias: 'Sherry', smoke: 0, cask: 5 }), ENTRY);

		const order = getParticipantView(db, ctx.ben, ORDER);
		expect(order.phase === 'order' && order.order.map((b) => b.alias).sort()).toEqual([
			'Blume',
			'Nebel',
			'Sherry',
			'Torf'
		]);
		const revealed = getParticipantView(db, ctx.ben, REVEALED);
		expect(
			revealed.phase === 'revealed' &&
				revealed.bottles
					.filter((b) => b.broughtBy === 'Anna')
					.map((b) => b.alias)
					.sort()
		).toEqual(['Nebel', 'Sherry', 'Torf']);
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

	describe('with archived bottles', () => {
		it('reveals them by bringer and slot, without factors, score and position', () => {
			const ctx = setup();
			// Lower case sorts like a word – SQLite would put it after all capitals.
			db.update(schema.user).set({ username: 'ben' }).where(eq(schema.user.id, 'u-ben')).run();
			insertArchivedBottle(ctx.anna.id, 3, 'Ahorn');
			insertArchivedBottle(ctx.cem.id, 1, 'Birke', {
				bottling: 'Sherry Cask',
				age: 12,
				whiskybaseUrl: 'https://www.whiskybase.com/whiskies/whisky/2',
				presentationFile: 'Tasting_2026-10-24_Birke.pptx',
				presentationName: 'Birke.pptx'
			});
			insertArchivedBottle(ctx.ben.id, 2, 'Moor');
			insertArchivedBottle(ctx.anna.id, 1, 'Zeder');

			const view = getParticipantView(db, ctx.ben, REVEALED);

			expect(view).toMatchObject({ phase: 'revealed', archived: true });
			if (view.phase !== 'revealed' || !view.archived) return;
			expect(view.bottles.map((b) => [b.broughtBy, b.alias])).toEqual([
				['Anna', 'Zeder'],
				['Anna', 'Ahorn'],
				['ben', 'Moor'],
				['Cem', 'Birke']
			]);
			expect(view.bottles[3]).toEqual({
				id: 'b-Birke',
				alias: 'Birke',
				distillery: 'Aberlour',
				bottler: null,
				bottling: 'Sherry Cask',
				age: 12,
				whiskybaseUrl: 'https://www.whiskybase.com/whiskies/whisky/2',
				abv: 40,
				broughtBy: 'Cem',
				presentation: { bottleId: 'b-Birke', viewable: true, name: 'Birke.pptx' }
			});
			const serialized = JSON.stringify(view);
			for (const hidden of ['smoke', 'cask', '"value"', 'score', 'position', 'breakdown']) {
				expect(serialized).not.toContain(hidden);
			}
		});

		it('shows a tasting mixing archived and entered bottles all archived', () => {
			const ctx = setup();
			saveBottle(db, ctx.anna, 1, bottle({ alias: 'Nebel' }), ENTRY);
			insertArchivedBottle(ctx.ben.id, 1, 'Moor');

			const view = getParticipantView(db, ctx.cem, REVEALED);
			expect(view).toMatchObject({
				phase: 'revealed',
				archived: true,
				bottles: [
					{ alias: 'Nebel', broughtBy: 'Anna', abv: 54.2 },
					{ alias: 'Moor', broughtBy: 'Ben', abv: 40 }
				]
			});
			expect(JSON.stringify(view)).not.toContain('smoke');
		});

		it.each([
			{ phase: 'entry', now: ENTRY },
			{ phase: 'order', now: ORDER }
		])('fails closed in the $phase phase, for every participant', ({ phase, now }) => {
			const ctx = setup();
			saveBottle(db, ctx.anna, 1, bottle(), ENTRY);
			insertArchivedBottle(ctx.ben.id, 1, 'Moor');

			for (const holder of [ctx.anna, ctx.ben, ctx.cem]) {
				expect(() => getParticipantView(db, holder, now)).toThrow(
					`tasting ${ctx.id} has archived bottles in phase ${phase}`
				);
			}
		});
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

	it('returns the management data of the tasting, but not its link', () => {
		const { id } = createTasting(
			db,
			newTasting({ motto: 'Sherry', mottoDescription: 'Nur Sherryfässer.' }),
			ENTRY
		);
		expect(getAdminTastingDetail(db, id, ENTRY)?.tasting).toEqual({
			id,
			name: 'Herbst-Tasting',
			motto: 'Sherry',
			mottoDescription: 'Nur Sherryfässer.',
			tastingDate: TASTING_DATE
		});
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

	it('raises only the own target of a participant with a further bottle', () => {
		const ctx = setup();
		fill(ctx);
		saveBottle(db, ctx.anna, 3, bottle({ alias: 'Rauch' }), ENTRY);
		saveBottle(db, ctx.ben, 1, bottle({ alias: 'Blume' }), ENTRY);

		expect(getAdminTastingDetail(db, ctx.id, ENTRY)?.participants.map((p) => p.progress)).toEqual([
			{ entered: 3, total: 3 },
			{ entered: 1, total: 2 },
			{ entered: 0, total: 2 }
		]);
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

	it('lists the motto heading, never its description, also in the start page preview', () => {
		const ctx = setup();
		updateTastingMotto(db, ctx.id, { motto: 'Inselhüpfen', mottoDescription: 'Nur Inseln.' });
		const plain = setup('2026-11-14');

		const list = listTastings(db, ENTRY);
		expect(list.map((t) => [t.id, t.motto])).toEqual([
			[plain.id, null],
			[ctx.id, 'Inselhüpfen']
		]);
		const preview = getStartPageSummary(db, ENTRY).preview;
		expect(preview.map((t) => [t.id, t.motto])).toEqual([
			[ctx.id, 'Inselhüpfen'],
			[plain.id, null]
		]);
		expect(JSON.stringify([list, preview])).not.toContain('Nur Inseln.');
	});

	it.each([
		{ entered: [2, 2, 3], progress: { entered: 7, total: 7 } },
		{ entered: [1, 1, 3], progress: { entered: 5, total: 7 } },
		{ entered: [0, 0, 6], progress: { entered: 6, total: 10 } }
	])('sums up each participant’s own target for $entered bottles', ({ entered, progress }) => {
		const ctx = setup();
		[ctx.anna, ctx.ben, ctx.cem].forEach((holder, i) => {
			for (let slot = 1; slot <= entered[i]; slot++) {
				saveBottle(db, holder, slot, bottle({ alias: `${holder.username} ${slot}` }), ENTRY);
			}
		});
		expect(listTastings(db, ENTRY)[0].progress).toEqual(progress);
	});

	it('shows no target for a tasting without participants', () => {
		db.insert(schema.tasting)
			.values({
				id: 't-empty',
				slug: 'shy-owl',
				name: 'Leer',
				tastingDate: TASTING_DATE,
				createdAt: ENTRY
			})
			.run();
		expect(listTastings(db, ENTRY)[0].progress).toEqual({ entered: 0, total: 0 });
	});

	it('counts and previews only unrevealed tastings, soonest first, flagging today', () => {
		setup('2026-10-21'); // revealed by REVEALED
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

describe('getDashboardTasting', () => {
	// An admin button press on a Thursday before the tasting.
	const PRESSED = new Date('2026-10-22T15:32:10Z');
	const NONE = { next: null, last: null };

	function revealByButton(id: string) {
		openOrderEarly(db, id, PRESSED);
		revealEarly(db, id, PRESSED);
	}

	it('shows the own next tasting with management data and the own progress only', () => {
		const ctx = setup();
		// The cards show the heading only, the description stays on the server.
		updateTastingMotto(db, ctx.id, {
			motto: 'Islay gegen den Rest',
			mottoDescription: 'Eine Flasche von Islay.'
		});
		saveBottle(db, ctx.anna, 1, bottle(), ENTRY);
		saveBottle(db, ctx.ben, 1, bottle({ alias: 'Torf' }), ENTRY);
		saveBottle(db, ctx.ben, 2, bottle({ alias: 'Rauch' }), ENTRY);

		expect(getDashboardTasting(db, 'u-anna', ENTRY)).toEqual({
			next: {
				slug: ctx.slug,
				name: 'Herbst-Tasting',
				motto: 'Islay gegen den Rest',
				tastingDate: TASTING_DATE,
				phase: 'entry',
				isToday: false,
				progress: { entered: 1, total: 2 }
			},
			last: null
		});
		expect(getDashboardTasting(db, 'u-cem', ENTRY).next?.progress).toEqual({
			entered: 0,
			total: 2
		});

		// A further bottle raises the own target, not the one of the others.
		saveBottle(db, ctx.ben, 3, bottle({ alias: 'Asche' }), ENTRY);
		expect(getDashboardTasting(db, 'u-ben', ENTRY).next?.progress).toEqual({
			entered: 3,
			total: 3
		});
		expect(getDashboardTasting(db, 'u-anna', ENTRY).next?.progress).toEqual({
			entered: 1,
			total: 2
		});
	});

	it('shows the own last revealed tasting with title, motto and date only', () => {
		const ctx = setup();
		updateTastingMotto(db, ctx.id, { motto: 'Sherry', mottoDescription: 'Nur Sherryfässer.' });
		saveBottle(db, ctx.anna, 1, bottle(), ENTRY);

		expect(getDashboardTasting(db, 'u-anna', REVEALED)).toEqual({
			next: null,
			last: { slug: ctx.slug, name: 'Herbst-Tasting', motto: 'Sherry', tastingDate: TASTING_DATE }
		});
	});

	it('returns neither without any participation, also for the admin', () => {
		setup();
		expect(getDashboardTasting(db, 'u-admin', ENTRY)).toEqual(NONE);
		expect(getDashboardTasting(db, 'u-admin', REVEALED)).toEqual(NONE);
	});

	it('only considers tastings the user takes part in', () => {
		const own = setup('2026-11-14');
		// Sooner and revealed sooner, but without Anna.
		const other = createTasting(db, newTasting({ participantUserIds: ['u-ben', 'u-cem'] }), ENTRY);

		expect(getDashboardTasting(db, 'u-anna', ENTRY).next?.slug).toBe(own.slug);
		expect(getDashboardTasting(db, 'u-anna', REVEALED)).toEqual({
			next: expect.objectContaining({ slug: own.slug }),
			last: null
		});
		expect(getDashboardTasting(db, 'u-ben', REVEALED).last?.slug).toBe(other.slug);
	});

	it('picks the soonest unrevealed tasting as next, a revealed one moves on to last', () => {
		const later = setup('2026-11-14');
		const sooner = setup(TASTING_DATE);
		expect(getDashboardTasting(db, 'u-anna', ENTRY)).toEqual({
			next: expect.objectContaining({ slug: sooner.slug }),
			last: null
		});
		expect(getDashboardTasting(db, 'u-anna', REVEALED)).toEqual({
			next: expect.objectContaining({ slug: later.slug, phase: 'entry' }),
			last: expect.objectContaining({ slug: sooner.slug })
		});
	});

	it('keeps an earlier tasting as next while the admin button reveals a later one', () => {
		const earlier = setup(TASTING_DATE);
		const later = setup('2026-11-14');
		revealByButton(later.id);
		expect(getDashboardTasting(db, 'u-anna', PRESSED)).toEqual({
			next: expect.objectContaining({ slug: earlier.slug, phase: 'entry' }),
			last: expect.objectContaining({ slug: later.slug })
		});
	});

	it('has no next tasting once all are revealed, without falling back to the last one', () => {
		setup('2026-10-21'); // revealed by the clock long before PRESSED
		const latest = setup(TASTING_DATE);
		revealByButton(latest.id);
		expect(getDashboardTasting(db, 'u-anna', PRESSED)).toEqual({
			next: null,
			last: expect.objectContaining({ slug: latest.slug })
		});
	});

	it('shows the order phase once the admin opened it', () => {
		const ctx = setup();
		openOrderEarly(db, ctx.id, PRESSED);
		expect(getDashboardTasting(db, 'u-anna', PRESSED)).toEqual({
			next: expect.objectContaining({ slug: ctx.slug, phase: 'order' }),
			last: null
		});
	});

	it('flags a tasting taking place today in Berlin', () => {
		setup();
		// 22:30 UTC on Friday is already Saturday in Berlin.
		expect(getDashboardTasting(db, 'u-anna', new Date('2026-10-23T22:30:00Z')).next?.isToday).toBe(
			true
		);
		expect(getDashboardTasting(db, 'u-anna', ENTRY).next?.isToday).toBe(false);
	});

	it('keeps tastings on the same date in creation order', () => {
		const first = setup();
		const second = setup();
		expect(getDashboardTasting(db, 'u-anna', ENTRY).next?.slug).toBe(first.slug);
		expect(getDashboardTasting(db, 'u-anna', REVEALED).last?.slug).toBe(second.slug);
	});

	it('carries no content in any phase, not even the own bottle and presentation', () => {
		const ctx = setup();
		const deck = 'Ardbeg-Uigeadail.pptx';
		saveBottle(db, ctx.anna, 1, bottle(), ENTRY, {
			tempFile: '.upload-1',
			name: deck,
			extension: presentationExtension(deck)
		});

		for (const [now, card] of [
			[ENTRY, 'next'],
			[ORDER, 'next'],
			[REVEALED, 'last']
		] as const) {
			const cards = getDashboardTasting(db, 'u-anna', now);
			expect(cards[card]?.slug).toBe(ctx.slug);
			const serialized = JSON.stringify(cards);
			for (const secret of ['Nebel', 'Ardbeg', 'Uigeadail', 'whiskybase', 'pptx']) {
				expect(serialized).not.toContain(secret);
			}
		}
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

describe('validateTastingMotto', () => {
	it('trims heading and description, empty or blank means none', () => {
		expect(validateTastingMotto('  Inselhüpfen ', '\n  Bringt Inseln mit.  \n')).toEqual({
			motto: 'Inselhüpfen',
			mottoDescription: 'Bringt Inseln mit.',
			fieldErrors: {}
		});
		expect(validateTastingMotto('   ', ' \r\n \t ')).toEqual({
			motto: null,
			mottoDescription: null,
			fieldErrors: {}
		});
		expect(validateTastingMotto('Sherry', '')).toEqual({
			motto: 'Sherry',
			mottoDescription: null,
			fieldErrors: {}
		});
	});

	it('keeps the line breaks of the description, normalized to \\n', () => {
		expect(
			validateTastingMotto('Inselhüpfen', 'Eine Insel pro Flasche.\r\n\r\nKeine Blends.\rDanke!')
				.mottoDescription
		).toBe('Eine Insel pro Flasche.\n\nKeine Blends.\nDanke!');
	});

	it('accepts the maximum lengths after trimming, one more character is invalid', () => {
		const heading = 'x'.repeat(TASTING_MOTTO_LENGTH.max);
		const description = 'y'.repeat(TASTING_MOTTO_DESCRIPTION_LENGTH.max);
		expect(validateTastingMotto(` ${heading} `, ` ${description} `)).toEqual({
			motto: heading,
			mottoDescription: description,
			fieldErrors: {}
		});
		expect(validateTastingMotto(`${heading}x`, `${description}y`).fieldErrors).toEqual({
			motto: 'invalid',
			mottoDescription: 'invalid'
		});
	});

	it('counts a \\r\\n line break as one character, like the textarea', () => {
		const description = `${'y'.repeat(TASTING_MOTTO_DESCRIPTION_LENGTH.max - 2)}\r\ny`;
		expect(validateTastingMotto('Sherry', description).fieldErrors).toEqual({});
	});

	it('refuses a description without a heading at the heading', () => {
		expect(validateTastingMotto('  ', 'Bringt Inseln mit.').fieldErrors).toEqual({
			motto: 'required'
		});
		const tooLong = 'y'.repeat(TASTING_MOTTO_DESCRIPTION_LENGTH.max + 1);
		expect(validateTastingMotto('', tooLong).fieldErrors).toEqual({
			motto: 'required',
			mottoDescription: 'invalid'
		});
	});
});

describe('updateTastingMotto', () => {
	const MOTTO = { motto: 'Inselhüpfen', mottoDescription: 'Bringt Inseln mit.\nKeine Blends.' };
	const NO_MOTTO = { motto: null, mottoDescription: null };

	function mottoOf(id: string) {
		const { motto, mottoDescription } = getAdminTastingDetail(db, id, ENTRY)!.tasting;
		return { motto, mottoDescription };
	}

	it.each([
		{ phase: 'entry', press: () => {} },
		{ phase: 'order', press: (id: string) => openOrderEarly(db, id, ENTRY) },
		{
			phase: 'revealed',
			press: (id: string) => {
				openOrderEarly(db, id, ENTRY);
				revealEarly(db, id, ENTRY);
			}
		}
	])('sets and clears heading and description in phase $phase', ({ phase, press }) => {
		const { id } = setup();
		press(id);
		expect(getAdminTastingDetail(db, id, ENTRY)!.phase).toBe(phase);

		expect(updateTastingMotto(db, id, MOTTO)).toBe(true);
		expect(mottoOf(id)).toEqual(MOTTO);
		expect(updateTastingMotto(db, id, { motto: 'Sherry', mottoDescription: null })).toBe(true);
		expect(mottoOf(id)).toEqual({ motto: 'Sherry', mottoDescription: null });
		expect(updateTastingMotto(db, id, NO_MOTTO)).toBe(true);
		expect(mottoOf(id)).toEqual(NO_MOTTO);
	});

	it('changes the motto of an archived tasting too', () => {
		const { id, anna } = setup('2026-10-03');
		insertArchivedBottle(anna.id, 1, 'Moor');
		expect(getAdminTastingDetail(db, id, ENTRY)!.phase).toBe('revealed');

		expect(updateTastingMotto(db, id, MOTTO)).toBe(true);
		expect(mottoOf(id)).toEqual(MOTTO);
	});

	it('returns false for an unknown tasting', () => {
		expect(updateTastingMotto(db, 'nope', MOTTO)).toBe(false);
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
		expect(order.phase === 'order' && order.order[0].presentation).toEqual({
			bottleId,
			viewable: true
		});
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
			viewable: true,
			name: DECK.name
		});
		// The view never carries the stored file name (only the download before the reveal).
		expect(JSON.stringify(revealed)).not.toContain(DECK_FILE);
	});

	it('marks only PDFs and office formats LibreOffice converts as viewable', () => {
		const ctx = setup();
		saveBottle(db, ctx.anna, 1, bottle({ alias: 'Folien' }), ENTRY, upload('a.PPTX'));
		saveBottle(db, ctx.anna, 2, bottle({ alias: 'Dokument' }), ENTRY, upload('b.pdf', '.upload-2'));
		saveBottle(db, ctx.ben, 1, bottle({ alias: 'Archiv' }), ENTRY, upload('c.zip', '.upload-3'));
		saveBottle(db, ctx.cem, 1, bottle({ alias: 'Ohne' }), ENTRY, upload('Vortrag', '.upload-4'));

		const viewable = (view: ReturnType<typeof getParticipantView>) =>
			Object.fromEntries(
				(view.phase === 'order' ? view.order : view.phase === 'revealed' ? view.bottles : []).map(
					(b) => [b.alias, b.presentation?.viewable]
				)
			);
		const expected = { Folien: true, Dokument: true, Archiv: false, Ohne: false };
		expect(viewable(getParticipantView(db, ctx.ben, ORDER))).toEqual(expected);
		expect(viewable(getParticipantView(db, ctx.ben, REVEALED))).toEqual(expected);
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

// An admin button press on a Thursday before the tasting.
const PRESSED = new Date('2026-10-22T15:32:10Z');

/** A tasting with one bottle of Anna and Ben each, entered during entry. */
function setupWithBottles(tastingDate = TASTING_DATE, participantUserIds = PARTICIPANT_IDS) {
	const { id, slug } = createTasting(db, newTasting({ tastingDate, participantUserIds }), ENTRY);
	const anna = findParticipant(db, slug, 'u-anna')!;
	const ben = findParticipant(db, slug, 'u-ben')!;
	saveBottle(db, anna, 1, bottle({ alias: `Nebel ${tastingDate}`, abv: 40 }), ENTRY);
	saveBottle(db, ben, 1, bottle({ alias: `Torf ${tastingDate}`, abv: 60, age: 12 }), ENTRY);
	return { id, slug, anna, ben };
}

/** A presentation for the participant's bottle; returns the bottle id. */
function addPresentation(participantId: string, presentationName: string | null = 'Islay.pptx') {
	db.update(schema.tastingBottle)
		.set({ presentationFile: 'Tasting_2026-10-24_Nebel.pptx', presentationName })
		.where(eq(schema.tastingBottle.participantId, participantId))
		.run();
	return db
		.select({ id: schema.tastingBottle.id })
		.from(schema.tastingBottle)
		.where(eq(schema.tastingBottle.participantId, participantId))
		.get()!.id;
}

describe('getStatistics', () => {
	const bringers = (result: ReturnType<typeof getStatistics>) =>
		result?.bottles.map((b) => [b.broughtBy, b.abv]) ?? null;

	it('is null while no tasting is revealed, before the order and after 18:00', () => {
		setupWithBottles();
		expect(getStatistics(db, 'u-anna', ENTRY)).toBeNull();
		expect(getStatistics(db, 'u-anna', ORDER)).toBeNull();
		// Sunday 8:59 in Berlin – one minute before the reveal.
		expect(getStatistics(db, 'u-anna', new Date('2026-10-25T07:59:00Z'))).toBeNull();
	});

	it('counts a tasting from 9:00 on the day after', () => {
		setupWithBottles();
		expect(bringers(getStatistics(db, 'u-anna', REVEALED))).toEqual([
			['Anna', 40],
			['Ben', 60]
		]);
	});

	it('counts a tasting the admin revealed early at once', () => {
		const ctx = setupWithBottles();
		openOrderEarly(db, ctx.id, PRESSED);
		revealEarly(db, ctx.id, PRESSED);
		expect(getStatistics(db, 'u-anna', PRESSED)?.overview).toMatchObject({
			tastings: 1,
			bottles: 2
		});
	});

	it('never includes bottles of tastings that are not revealed, not even in the totals', () => {
		setupWithBottles('2026-10-21');
		setupWithBottles();
		const result = getStatistics(db, 'u-anna', ORDER)!;
		expect(result.overview).toMatchObject({ tastings: 1, bottles: 2 });
		expect(result.alcohol.pureMl).toBeCloseTo(50, 10);
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain('2026-10-24');
	});

	it('leaves out everything only the history shows, also for the own tasting', () => {
		const ctx = setupWithBottles();
		const annaBottle = addPresentation(ctx.anna.id);
		updateTastingMotto(db, ctx.id, { motto: 'Inselhüpfen', mottoDescription: 'Nur Inseln.' });

		const own = getStatistics(db, 'u-anna', REVEALED)!;
		// No factors either: the bottles carry exactly these fields (a record's
		// "value" is its ABV or age, not the factor).
		expect(Object.keys(own.bottles[0]).sort()).toEqual([
			'abv',
			'age',
			'bottler',
			'bottling',
			'broughtBy',
			'distillery',
			'number',
			'tastingDate'
		]);
		const serialized = JSON.stringify(own);
		for (const hidden of [
			ctx.slug,
			annaBottle,
			ctx.id,
			'Nebel 2026-10-24',
			'whiskybase.com',
			'Islay.pptx',
			'Tasting_2026',
			'Inselhüpfen',
			'Nur Inseln.'
		]) {
			expect(serialized).not.toContain(hidden);
		}
		expect(serialized).not.toMatch(/"(smoke|cask|score)":/);
	});

	it('includes archived tastings with their ABV only', () => {
		const ctx = setup();
		insertArchivedBottle(ctx.anna.id, 1, 'Ahorn', { abv: 43 });
		insertArchivedBottle(ctx.cem.id, 1, 'Birke', { abv: 57 });
		const result = getStatistics(db, 'u-ben', REVEALED)!;
		expect(bringers(result)).toEqual([
			['Anna', 43],
			['Cem', 57]
		]);
		expect(result.overview.meanAbv).toBe(50);
	});

	it('marks deactivated bringers', () => {
		setupWithBottles();
		db.update(schema.user).set({ deactivatedAt: ORDER }).where(eq(schema.user.id, 'u-ben')).run();
		const result = getStatistics(db, 'u-anna', REVEALED)!;
		expect(result.bottles.map((b) => b.broughtBy)).toEqual(['Anna', 'Ben (inaktiv)']);
		expect(result.people.persons.map((p) => p.name)).toEqual(['Anna', 'Ben (inaktiv)']);
	});

	it('counts the pure alcohol per person of each tasting, also when somebody was missing', () => {
		// 50 ml samples at 40 % and 60 %: 50 ml pure alcohol per person.
		setupWithBottles('2026-10-21');
		// Cem missed this one: still 50 ml for everybody who was there.
		setupWithBottles(TASTING_DATE, ['u-anna', 'u-ben']);
		const { alcohol } = getStatistics(db, 'u-cem', REVEALED)!;
		expect(alcohol.pureMl).toBeCloseTo(100, 10);
		expect(alcohol.hardest).toEqual({ tastingDate: '2026-10-21', pureMl: 50 });
	});

	it('orders same-day tastings by creation', () => {
		setupWithBottles();
		const later = createTasting(db, newTasting(), ENTRY);
		saveBottle(db, findParticipant(db, later.slug, 'u-cem')!, 1, bottle({ abv: 45 }), ENTRY);
		const result = getStatistics(db, 'u-anna', REVEALED)!;
		expect(result.bottles.map((b) => [b.number, b.broughtBy, b.abv])).toEqual([
			[1, 'Anna', 40],
			[2, 'Ben', 60],
			[3, 'Cem', 45]
		]);
	});

	it('adds the known facts of the revealed distilleries, matched by name key', () => {
		const ctx = setupWithBottles();
		saveBottle(
			db,
			findParticipant(db, ctx.slug, 'u-cem')!,
			1,
			bottle({ alias: 'Moor', distillery: 'Lagavulin' }),
			ENTRY
		);
		// Still in the entry phase: neither its country nor its capacity may count.
		const later = setupWithBottles('2026-10-31');
		db.update(schema.tastingBottle)
			.set({ distillery: 'Kavalan' })
			.where(eq(schema.tastingBottle.participantId, later.anna.id))
			.run();
		const facts = (nameKey: string, country: string, capacity: number) =>
			db
				.insert(schema.distillery)
				.values({
					nameKey,
					country,
					countryState: 'admin',
					capacity,
					capacityState: 'admin',
					updatedAt: ENTRY
				})
				.run();
		facts('ardbeg', 'Schottland', 2_400_000);
		facts('lagavulin', 'Schottland', 2_530_000);
		facts('kavalan', 'Taiwan', 9_000_000);

		const result = getStatistics(db, 'u-anna', REVEALED)!;
		expect(result.overview).toMatchObject({ distilleries: 2, countries: 1, withoutCountry: 0 });
		expect(result.people.persons.map((p) => [p.name, p.countries])).toEqual([
			['Anna', 1],
			['Ben', 1],
			['Cem', 1]
		]);
		expect(result.people.capacity).toEqual({
			largest: { capacity: 2_530_000, distilleries: ['Lagavulin'], persons: ['Cem'] },
			smallest: { capacity: 2_400_000, distilleries: ['Ardbeg'], persons: ['Anna', 'Ben'] }
		});
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain('Kavalan');
		expect(serialized).not.toContain('Taiwan');
		expect(serialized).not.toContain('9000000');
	});

	it('counts distilleries without a known country, also without any facts at all', () => {
		setupWithBottles();
		expect(getStatistics(db, 'u-anna', REVEALED)!.overview).toMatchObject({
			countries: 0,
			withoutCountry: 1
		});
		expect(getStatistics(db, 'u-anna', REVEALED)!.people.capacity).toBeNull();
	});

	it('looks up no facts for a revealed tasting without bottles', () => {
		setup();
		expect(getStatistics(db, 'u-anna', REVEALED)!.overview).toMatchObject({
			bottles: 0,
			countries: 0,
			withoutCountry: 0
		});
	});
});

describe('getWorldMap', () => {
	const facts = (nameKey: string, country: string, region: 'Islay' | 'Highlands' | null) =>
		db
			.insert(schema.distillery)
			.values({
				nameKey,
				country,
				countryState: 'admin',
				region,
				regionState: region === null ? 'empty' : 'admin',
				updatedAt: ENTRY
			})
			.run();

	it('is null while no tasting is revealed', () => {
		setupWithBottles();
		expect(getWorldMap(db, 'u-anna', ENTRY)).toBeNull();
		expect(getWorldMap(db, 'u-anna', ORDER)).toBeNull();
	});

	it('counts the revealed bottles by the facts of their distillery, matched by name key', () => {
		const ctx = setupWithBottles();
		saveBottle(
			db,
			findParticipant(db, ctx.slug, 'u-cem')!,
			1,
			bottle({ alias: 'Moor', distillery: 'kavalan ' }),
			ENTRY
		);
		facts('ardbeg', 'Schottland', 'Islay');
		facts('kavalan', 'Taiwan', null);

		const result = getWorldMap(db, 'u-anna', REVEALED)!;
		expect(result.countries.map((c) => [c.code, c.bottles.length, c.distilleries])).toEqual([
			['GB-SCT', 2, 1],
			['TW', 1, 1]
		]);
		expect(result.regions.find((r) => r.region === 'Islay')).toEqual({
			region: 'Islay',
			bottles: 2,
			distilleries: [{ name: 'Ardbeg', bottles: 2 }]
		});
		expect(result.withoutCountry).toEqual([]);
		// The bottles carry exactly the fields of the statistics.
		expect(Object.keys(result.countries[0].bottles[0]).sort()).toEqual([
			'abv',
			'age',
			'bottler',
			'bottling',
			'broughtBy',
			'distillery',
			'number',
			'tastingDate'
		]);
	});

	it('never counts bottles of tastings that are not revealed, until the admin reveals them', () => {
		setupWithBottles('2026-10-21');
		const later = setupWithBottles();
		db.update(schema.tastingBottle)
			.set({ distillery: 'Kavalan' })
			.where(eq(schema.tastingBottle.participantId, later.anna.id))
			.run();
		facts('ardbeg', 'Schottland', 'Islay');
		facts('kavalan', 'Taiwan', null);

		const before = getWorldMap(db, 'u-anna', PRESSED)!;
		expect(before.countries.map((c) => [c.code, c.bottles.length])).toEqual([['GB-SCT', 2]]);
		const serialized = JSON.stringify(before);
		expect(serialized).not.toContain('Kavalan');
		expect(serialized).not.toContain('TW');
		expect(serialized).not.toContain('2026-10-24');

		openOrderEarly(db, later.id, PRESSED);
		revealEarly(db, later.id, PRESSED);
		const after = getWorldMap(db, 'u-anna', PRESSED)!;
		expect(after.countries.map((c) => [c.code, c.bottles.length])).toEqual([
			['GB-SCT', 3],
			['TW', 1]
		]);
	});

	it('leaves out slug, alias, presentation, Whiskybase link and the facts beyond the code', () => {
		const ctx = setupWithBottles();
		addPresentation(ctx.anna.id);
		db.insert(schema.distillery)
			.values({
				nameKey: 'ardbeg',
				country: 'Schottland',
				countryState: 'found',
				countrySource: 'https://example.org/ardbeg',
				region: 'Islay',
				regionState: 'found',
				capacity: 2_400_000,
				capacityState: 'admin',
				updatedAt: ENTRY
			})
			.run();
		const serialized = JSON.stringify(getWorldMap(db, 'u-anna', REVEALED));
		for (const hidden of [
			ctx.slug,
			'Nebel',
			'Torf',
			'Islay.pptx',
			'whiskybase',
			'example.org',
			'2400000',
			'found',
			'Schottland'
		]) {
			expect(serialized).not.toContain(hidden);
		}
	});

	it('puts distilleries without facts under "Ohne Länderangabe"', () => {
		setupWithBottles();
		const result = getWorldMap(db, 'u-anna', REVEALED)!;
		expect(result.countries).toEqual([]);
		expect(result.withoutCountry.map((b) => b.broughtBy)).toEqual(['Anna', 'Ben']);
	});

	it('looks up no facts for a revealed tasting without bottles', () => {
		setup();
		expect(getWorldMap(db, 'u-anna', REVEALED)).toMatchObject({
			countries: [],
			withoutCountry: [],
			scotlandWithoutRegion: 0
		});
	});
});

describe('getHistory', () => {
	const aliases = (result: ReturnType<typeof getHistory>) => result?.map((b) => b.alias) ?? null;

	it('is null while no tasting is revealed and leaves out tastings that are not', () => {
		setupWithBottles();
		expect(getHistory(db, 'u-anna', ORDER)).toBeNull();

		setupWithBottles('2026-10-31');
		const result = getHistory(db, 'u-anna', REVEALED)!;
		expect(aliases(result)).toEqual(['Nebel 2026-10-24', 'Torf 2026-10-24']);
		expect(JSON.stringify(result)).not.toContain('2026-10-31');
	});

	it('lists the newest tasting first, within one by bringer and slot', () => {
		setupWithBottles('2026-10-21');
		const ctx = setupWithBottles();
		saveBottle(db, ctx.anna, 3, bottle({ alias: 'Dritte' }), ENTRY);
		expect(getHistory(db, 'u-cem', REVEALED)!.map((b) => [b.number, b.alias])).toEqual([
			[3, 'Nebel 2026-10-24'],
			[4, 'Dritte'],
			[5, 'Torf 2026-10-24'],
			[1, 'Nebel 2026-10-21'],
			[2, 'Torf 2026-10-21']
		]);
	});

	it('shows every user all revealed tastings, with slug and download only for their own', () => {
		const ctx = setupWithBottles();
		const annaBottle = addPresentation(ctx.anna.id);

		const own = getHistory(db, 'u-anna', REVEALED)!;
		expect(own.map((b) => [b.slug, b.presentation])).toEqual([
			[ctx.slug, { bottleId: annaBottle, viewable: true }],
			[ctx.slug, null]
		]);
		// Neither file name leaves the server, not even for the own tasting.
		expect(JSON.stringify(own)).not.toMatch(/Islay\.pptx|Tasting_2026/);

		// The admin without a participation sees the same bottles, but neither
		// the link nor the bottle id.
		const other = getHistory(db, 'u-admin', REVEALED)!;
		expect(other.map((b) => [b.alias, b.slug, b.presentation])).toEqual([
			['Nebel 2026-10-24', null, null],
			['Torf 2026-10-24', null, null]
		]);
		const serialized = JSON.stringify(other);
		for (const hidden of [ctx.slug, annaBottle, ctx.id, 'Islay.pptx', 'Tasting_2026']) {
			expect(serialized).not.toContain(hidden);
		}
		// No factors: the bottles carry exactly these fields.
		expect(Object.keys(other[0]).sort()).toEqual([
			'abv',
			'age',
			'alias',
			'bottler',
			'bottling',
			'broughtBy',
			'distillery',
			'motto',
			'number',
			'presentation',
			'slug',
			'tastingDate',
			'whiskybaseUrl'
		]);
		expect(serialized).not.toMatch(/"(smoke|cask|score)":/);
	});

	it('carries the motto heading of each bottle’s tasting, never its description', () => {
		setupWithBottles('2026-10-21');
		const ctx = setupWithBottles();
		updateTastingMotto(db, ctx.id, { motto: 'Inselhüpfen', mottoDescription: 'Nur Inseln.' });

		const result = getHistory(db, 'u-admin', REVEALED)!;
		expect(result.map((b) => [b.tastingDate, b.motto])).toEqual([
			['2026-10-24', 'Inselhüpfen'],
			['2026-10-24', 'Inselhüpfen'],
			['2026-10-21', null],
			['2026-10-21', null]
		]);
		expect(JSON.stringify(result)).not.toContain('Nur Inseln.');
	});

	it('links a presentation only with file and name, like the download route', () => {
		const ctx = setupWithBottles();
		// Not possible via the app, but via a direct write such as the history import.
		addPresentation(ctx.anna.id, null);
		expect(getHistory(db, 'u-anna', REVEALED)!.map((b) => [b.alias, b.presentation])).toEqual([
			['Nebel 2026-10-24', null],
			['Torf 2026-10-24', null]
		]);
	});

	it('offers the viewer only for viewable formats', () => {
		const ctx = setupWithBottles();
		const annaBottle = addPresentation(ctx.anna.id);
		const benBottle = addPresentation(ctx.ben.id);
		db.update(schema.tastingBottle)
			.set({ presentationFile: 'Tasting_2026-10-24_Torf.zip' })
			.where(eq(schema.tastingBottle.id, benBottle))
			.run();
		expect(getHistory(db, 'u-anna', REVEALED)!.map((b) => b.presentation)).toEqual([
			{ bottleId: annaBottle, viewable: true },
			{ bottleId: benBottle, viewable: false }
		]);
	});

	it('marks deactivated bringers and includes archived bottles', () => {
		const ctx = setup();
		insertArchivedBottle(ctx.ben.id, 1, 'Ahorn', { abv: 43 });
		db.update(schema.user).set({ deactivatedAt: ORDER }).where(eq(schema.user.id, 'u-ben')).run();
		expect(getHistory(db, 'u-anna', REVEALED)!.map((b) => [b.alias, b.broughtBy, b.abv])).toEqual([
			['Ahorn', 'Ben (inaktiv)', 43]
		]);
	});

	it('numbers every bottle like the statistics, whose links point at its rows', () => {
		setupWithBottles('2026-10-21');
		const ctx = setupWithBottles();
		saveBottle(db, ctx.ben, 2, bottle({ alias: 'Zweite', abv: 51 }), ENTRY);
		const later = createTasting(db, newTasting(), ENTRY);
		saveBottle(db, findParticipant(db, later.slug, 'u-cem')!, 1, bottle({ abv: 45 }), ENTRY);

		const row = (b: { number: number; tastingDate: string; broughtBy: string; abv: number }) => [
			b.number,
			b.tastingDate,
			b.broughtBy,
			b.abv
		];
		const history = getHistory(db, 'u-anna', REVEALED)!;
		const statistics = getStatistics(db, 'u-anna', REVEALED)!;
		expect(statistics.bottles.map((b) => b.number)).toEqual([1, 2, 3, 4, 5, 6]);
		expect([...history].sort((a, b) => a.number - b.number).map(row)).toEqual(
			statistics.bottles.map(row)
		);
	});
});
