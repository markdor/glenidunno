import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TASTING_SLUG_RE } from '$lib/validation';
import { runMigrations } from './migrate';

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempMigrationsDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'glenidunno-migrations-'));
	tempDirs.push(dir);
	mkdirSync(join(dir, 'meta'));
	return dir;
}

type JournalEntry = { idx: number; tag: string };

/** The real migrations, cut off after `lastTag` – a database from the past. */
function realMigrationsUpTo(lastTag: string): string {
	const journal = JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf8'));
	const end = journal.entries.findIndex((e: JournalEntry) => e.tag === lastTag);
	const entries = journal.entries.slice(0, end + 1);
	const dir = tempMigrationsDir();
	for (const { tag } of entries)
		copyFileSync(join('drizzle', `${tag}.sql`), join(dir, `${tag}.sql`));
	writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
	return dir;
}

/** Bottle rows from before migration 0009, which adds the archive flag – off for all of them. */
function notArchived(bottles: unknown[]): unknown[] {
	return bottles.map((bottle) => ({ ...(bottle as object), archived: 0 }));
}

/** A throwaway migrations folder in drizzle-kit's layout (SQL files + journal). */
function migrationsFolder(migrations: string[][]): string {
	const dir = tempMigrationsDir();
	const entries = migrations.map((statements, idx) => {
		const tag = `000${idx}_test`;
		writeFileSync(join(dir, `${tag}.sql`), statements.join('\n--> statement-breakpoint\n'));
		return { idx, version: '6', when: 1_000 + idx, tag, breakpoints: true };
	});
	writeFileSync(
		join(dir, 'meta', '_journal.json'),
		JSON.stringify({ version: '7', dialect: 'sqlite', entries })
	);
	return dir;
}

const CREATE_PARENT_AND_CHILD = [
	'CREATE TABLE parent (id text PRIMARY KEY NOT NULL)',
	`CREATE TABLE child (
		id text PRIMARY KEY NOT NULL,
		parent_id text NOT NULL REFERENCES parent(id) ON DELETE cascade
	)`,
	"INSERT INTO parent VALUES ('p1')",
	"INSERT INTO child VALUES ('c1', 'p1')"
];

// What drizzle-kit generates for a table rebuild in SQLite.
const REBUILD_PARENT = [
	'PRAGMA foreign_keys=OFF',
	'CREATE TABLE __new_parent (id text PRIMARY KEY NOT NULL, note text)',
	'INSERT INTO __new_parent (id) SELECT id FROM parent',
	'DROP TABLE parent',
	'ALTER TABLE __new_parent RENAME TO parent',
	'PRAGMA foreign_keys=ON'
];

describe('runMigrations', () => {
	it('applies the real migrations and leaves foreign keys on', () => {
		const sqlite = new Database(':memory:');
		runMigrations(sqlite, './drizzle');

		const journal = JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf8'));
		expect(sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
			n: journal.entries.length
		});
		expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
	});

	it('keeps the rows of a child table when its parent table is rebuilt', () => {
		const sqlite = new Database(':memory:');
		runMigrations(sqlite, migrationsFolder([CREATE_PARENT_AND_CHILD, REBUILD_PARENT]));

		expect(sqlite.prepare('SELECT id, parent_id FROM child').all()).toEqual([
			{ id: 'c1', parent_id: 'p1' }
		]);
	});

	it('guards against the cascade that plain migrate() runs into', () => {
		// The regression this module exists for: inside drizzle's transaction the
		// generated PRAGMA foreign_keys=OFF is a no-op, DROP TABLE cascades.
		const sqlite = new Database(':memory:');
		sqlite.pragma('foreign_keys = ON');
		migrate(drizzle(sqlite), {
			migrationsFolder: migrationsFolder([CREATE_PARENT_AND_CHILD, REBUILD_PARENT])
		});

		expect(sqlite.prepare('SELECT id FROM child').all()).toEqual([]);
	});

	it('throws on foreign key violations and still switches foreign keys back on', () => {
		const sqlite = new Database(':memory:');
		const folder = migrationsFolder([
			[...CREATE_PARENT_AND_CHILD, "INSERT INTO child VALUES ('c2', 'missing')"]
		]);

		expect(() => runMigrations(sqlite, folder)).toThrow(
			/foreign key check failed after migrations: 1 violation\(s\), e\.g\. child#\d+ → parent/
		);
		expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
	});
});

describe('migrations 0004–0006: tasting participants become users', () => {
	let sqlite: Database.Database;
	let before: { bottles: unknown[]; throttle: unknown[]; tastings: unknown[] };

	/** Rows as the token-link version (state 0003) wrote them. */
	function seedLegacyData() {
		const user = sqlite.prepare(
			`INSERT INTO user (id, name, email, email_verified, created_at, updated_at, username, is_admin)
			 VALUES (?, ?, ?, 1, 1, 1, ?, ?)`
		);
		user.run('u-markus', 'Markus', 'markus@example.com', 'Markus', 1);
		user.run('u-josh', 'josh', 'josh@example.com', 'josh', 0);

		const tasting = sqlite.prepare('INSERT INTO tasting VALUES (?, ?, ?, 2, ?, ?, ?)');
		tasting.run('t-autumn', 'Herbst', '2026-10-24', 100, 1000, 2000);
		tasting.run('t-winter', 'Winter', '2026-12-12', 200, null, null);

		// One insert per tasting gave all its participants the same created_at:
		// the rowid keeps the order the admin entered them in.
		const participant = sqlite.prepare('INSERT INTO tasting_participant VALUES (?, ?, ?, ?, 100)');
		for (const [id, tastingId, name] of [
			['p-markus', 't-autumn', 'Markus'],
			['p-josh', 't-autumn', 'Josh '],
			['p-patrick', 't-autumn', 'Patrick'],
			['p-anna', 't-autumn', 'Anna'],
			['p-ben', 't-winter', 'Ben'],
			['p-patrick-winter', 't-winter', 'patrick']
		]) {
			participant.run(id, tastingId, name, `hash-${id}`);
		}

		const bottle = sqlite.prepare(
			`INSERT INTO tasting_bottle (id, participant_id, slot, alias, distillery, smoke, cask, abv,
			   value, updated_at, presentation_file, presentation_name)
			 VALUES (?, ?, 1, ?, ?, 3, 2, 46.3, 3, 300, ?, ?)`
		);
		bottle.run(
			'b-nebel',
			'p-markus',
			'Nebel',
			'Ardbeg',
			'Tasting_2026-10-24_Nebel.pptx',
			'Vortrag.pptx'
		);
		bottle.run('b-bluete', 'p-anna', 'Blüte', 'Glenkinchie', null, null);
		bottle.run('b-torf', 'p-patrick-winter', 'Torf', 'Laphroaig', null, null);
		sqlite.prepare("INSERT INTO tasting_write_throttle VALUES ('p-patrick', 4, 300)").run();
	}

	function rows(query: string): unknown[] {
		return sqlite.prepare(query).all();
	}

	// Without bottles_per_participant: migration 0008 drops it.
	const TASTING_COLUMNS = 'id, name, tasting_date, created_at, order_opened_at, revealed_at';

	beforeEach(() => {
		sqlite = new Database(':memory:');
		runMigrations(sqlite, realMigrationsUpTo('0003_tasting_presentation'));
		seedLegacyData();
		before = {
			bottles: rows('SELECT * FROM tasting_bottle ORDER BY id'),
			throttle: rows('SELECT * FROM tasting_write_throttle'),
			tastings: rows(`SELECT ${TASTING_COLUMNS} FROM tasting ORDER BY id`)
		};
		runMigrations(sqlite, './drizzle');
	});

	it('keeps bottles, presentations, throttle rows, dates and manual timestamps', () => {
		expect(rows('SELECT * FROM tasting_bottle ORDER BY id')).toEqual(notArchived(before.bottles));
		expect(rows('SELECT * FROM tasting_write_throttle')).toEqual(before.throttle);
		expect(rows(`SELECT ${TASTING_COLUMNS} FROM tasting ORDER BY id`)).toEqual(before.tastings);
	});

	it('maps every participant to a user, matching usernames case-insensitively', () => {
		expect(
			rows(
				`SELECT p.id, u.username FROM tasting_participant p JOIN user u ON u.id = p.user_id
				 ORDER BY p.tasting_id, p.created_at, p.rowid`
			)
		).toEqual([
			{ id: 'p-markus', username: 'Markus' },
			{ id: 'p-josh', username: 'josh' },
			{ id: 'p-patrick', username: 'Patrick' },
			{ id: 'p-anna', username: 'Anna' },
			{ id: 'p-ben', username: 'Ben' },
			{ id: 'p-patrick-winter', username: 'Patrick' }
		]);
	});

	it('creates one user per remaining name with a numbered placeholder address', () => {
		const created = rows(
			`SELECT id, name, username, email, email_verified, is_admin, deactivated_at FROM user
			 WHERE id NOT IN ('u-markus', 'u-josh') ORDER BY email`
		) as Array<{ id: string }>;

		expect(created.map(({ id: _id, ...user }) => user)).toEqual(
			[
				['Patrick', 'dummy-1@dummy.invalid'],
				['Anna', 'dummy-2@dummy.invalid'],
				['Ben', 'dummy-3@dummy.invalid']
			].map(([username, email]) => ({
				name: username,
				username,
				email,
				email_verified: 1,
				is_admin: 0,
				deactivated_at: null
			}))
		);
		for (const { id } of created) {
			expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		}
		expect(rows("SELECT is_admin FROM user WHERE id = 'u-markus'")).toEqual([{ is_admin: 1 }]);
	});

	it('gives every tasting its own slug from the word lists', () => {
		const slugs = sqlite.prepare('SELECT slug FROM tasting').pluck().all() as string[];
		expect(slugs).toHaveLength(2);
		expect(new Set(slugs).size).toBe(2);
		for (const slug of slugs) {
			expect(slug).toMatch(TASTING_SLUG_RE);
			const [adjective, animal] = slug.split('-');
			expect(rows(`SELECT 1 FROM tasting_slug_adjective WHERE word = '${adjective}'`)).toHaveLength(
				1
			);
			expect(rows(`SELECT 1 FROM tasting_slug_animal WHERE word = '${animal}'`)).toHaveLength(1);
		}
	});

	it('seeds 100 adjectives and 100 animals of lower-case letters only', () => {
		for (const table of ['tasting_slug_adjective', 'tasting_slug_animal']) {
			const words = sqlite.prepare(`SELECT word FROM ${table}`).pluck().all() as string[];
			expect(words, table).toHaveLength(100);
			for (const word of words) expect(word, table).toMatch(/^[a-z]+$/);
		}
	});

	it('leaves no temporary tables and enforces the new foreign keys', () => {
		expect(rows('SELECT name FROM sqlite_temp_master')).toEqual([]);
		expect(() => sqlite.prepare("DELETE FROM user WHERE id = 'u-josh'").run()).toThrow(
			/FOREIGN KEY constraint failed/
		);
	});
});

describe('migration 0007: tasting motto', () => {
	it('keeps existing tastings, without a motto', () => {
		const sqlite = new Database(':memory:');
		runMigrations(sqlite, realMigrationsUpTo('0006_tasting_users_finalize'));
		sqlite
			.prepare(
				`INSERT INTO tasting (id, slug, name, tasting_date, bottles_per_participant, created_at)
				 VALUES ('t-autumn', 'fluffy-otter', 'Herbst', '2026-10-24', 2, 100)`
			)
			.run();

		runMigrations(sqlite, './drizzle');

		expect(sqlite.prepare('SELECT id, name, motto FROM tasting').all()).toEqual([
			{ id: 't-autumn', name: 'Herbst', motto: null }
		]);
	});
});

describe('migration 0008: no fixed number of bottles per participant', () => {
	let sqlite: Database.Database;

	function rows(query: string): unknown[] {
		return sqlite.prepare(query).all();
	}

	const TABLES = ['tasting_participant', 'tasting_bottle', 'tasting_write_throttle'];
	const TASTING_COLUMNS =
		'id, slug, name, tasting_date, created_at, order_opened_at, revealed_at, motto';

	/** Rows as the version with a fixed number per tasting (state 0007) wrote them. */
	function seed() {
		const user = sqlite.prepare(
			`INSERT INTO user (id, name, email, email_verified, created_at, updated_at, username, is_admin)
			 VALUES (?, ?, ?, 1, 1, 1, ?, 0)`
		);
		user.run('u-anna', 'Anna', 'anna@example.com', 'Anna');
		user.run('u-ben', 'Ben', 'ben@example.com', 'Ben');

		sqlite
			.prepare(
				`INSERT INTO tasting (id, slug, name, tasting_date, bottles_per_participant, created_at,
				   order_opened_at, revealed_at, motto)
				 VALUES ('t-autumn', 'fluffy-otter', 'Herbst', '2026-10-24', 3, 100, 1000, 2000, 'Islay')`
			)
			.run();
		const participant = sqlite.prepare(
			"INSERT INTO tasting_participant VALUES (?, 't-autumn', ?, 100)"
		);
		participant.run('p-anna', 'u-anna');
		participant.run('p-ben', 'u-ben');

		const bottle = sqlite.prepare(
			`INSERT INTO tasting_bottle (id, participant_id, slot, alias, distillery, smoke, cask, abv,
			   value, updated_at, presentation_file, presentation_name)
			 VALUES (?, ?, ?, ?, 'Ardbeg', 3, 2, 46.3, 3, 300, ?, ?)`
		);
		bottle.run('b-nebel', 'p-anna', 1, 'Nebel', null, null);
		bottle.run('b-torf', 'p-anna', 3, 'Torf', 'Tasting_2026-10-24_Torf.pptx', 'Vortrag.pptx');
		bottle.run('b-blume', 'p-ben', 2, 'Blume', null, null);
		sqlite.prepare("INSERT INTO tasting_write_throttle VALUES ('p-anna', 4, 300)").run();
	}

	beforeEach(() => {
		sqlite = new Database(':memory:');
		runMigrations(sqlite, realMigrationsUpTo('0007_tasting_motto'));
		seed();
	});

	it('keeps tastings, participants, bottles and throttle rows', () => {
		const before: Record<string, unknown[]> = {
			...Object.fromEntries(TABLES.map((t) => [t, rows(`SELECT * FROM ${t} ORDER BY rowid`)])),
			tasting: rows(`SELECT ${TASTING_COLUMNS} FROM tasting`)
		};
		before.tasting_bottle = notArchived(before.tasting_bottle);

		runMigrations(sqlite, './drizzle');

		for (const table of TABLES) {
			expect(rows(`SELECT * FROM ${table} ORDER BY rowid`), table).toEqual(before[table]);
		}
		expect(rows(`SELECT ${TASTING_COLUMNS} FROM tasting`)).toEqual(before.tasting);
		expect(sqlite.pragma('foreign_key_check')).toEqual([]);
		expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
	});

	it('drops the column, but keeps the name check and the unique slug', () => {
		runMigrations(sqlite, './drizzle');

		const columns = (sqlite.pragma('table_info(tasting)') as Array<{ name: string }>).map(
			(c) => c.name
		);
		expect(columns).not.toContain('bottles_per_participant');
		const insert = sqlite.prepare(
			"INSERT INTO tasting (id, slug, name, tasting_date, created_at) VALUES (?, ?, ?, '2026-12-12', 1)"
		);
		expect(() => insert.run('t-empty', 'shy-owl', '')).toThrow(/CHECK constraint failed/);
		expect(() => insert.run('t-twin', 'fluffy-otter', 'Winter')).toThrow(
			/UNIQUE constraint failed/
		);
		expect(rows('SELECT name FROM sqlite_temp_master')).toEqual([]);
	});
});

describe('migrations 0009–0010: archived bottles', () => {
	let sqlite: Database.Database;

	function rows(query: string): unknown[] {
		return sqlite.prepare(query).all();
	}

	/** Rows as the version without archived bottles (state 0008) wrote them. */
	function seed() {
		sqlite
			.prepare(
				`INSERT INTO user (id, name, email, email_verified, created_at, updated_at, username, is_admin)
				 VALUES ('u-anna', 'Anna', 'anna@example.com', 1, 1, 1, 'Anna', 0)`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO tasting (id, slug, name, tasting_date, created_at)
				 VALUES ('t-autumn', 'fluffy-otter', 'Herbst', '2026-10-24', 100)`
			)
			.run();
		sqlite
			.prepare("INSERT INTO tasting_participant VALUES ('p-anna', 't-autumn', 'u-anna', 100)")
			.run();

		const bottle = sqlite.prepare(
			`INSERT INTO tasting_bottle (id, participant_id, slot, alias, distillery, bottling, smoke,
			   cask, abv, value, updated_at, presentation_file, presentation_name)
			 VALUES (?, 'p-anna', ?, ?, 'Ardbeg', ?, ?, 2, 46.3, ?, 300, ?, ?)`
		);
		bottle.run('b-nebel', 1, 'Nebel', 'x'.repeat(80), 0, 0, null, null);
		bottle.run('b-torf', 3, 'Torf', null, 5, 5, 'Tasting_2026-10-24_Torf.pptx', 'Vortrag.pptx');
	}

	beforeEach(() => {
		sqlite = new Database(':memory:');
		runMigrations(sqlite, realMigrationsUpTo('0008_tasting_drop_bottles_per_participant'));
		seed();
	});

	it('keeps every bottle with its factors and presentation, none of them archived', () => {
		const before = rows('SELECT * FROM tasting_bottle ORDER BY id');

		runMigrations(sqlite, './drizzle');

		expect(rows('SELECT * FROM tasting_bottle ORDER BY id')).toEqual(notArchived(before));
		expect(sqlite.pragma('foreign_key_check')).toEqual([]);
		expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
	});

	it('keeps the unique slot and the cascade, and checks the factors of existing bottles', () => {
		runMigrations(sqlite, './drizzle');

		expect(() =>
			sqlite
				.prepare(
					`INSERT INTO tasting_bottle (id, participant_id, slot, alias, distillery, smoke, cask,
					   abv, value, updated_at)
					 VALUES ('b-twin', 'p-anna', 1, 'Zwilling', 'Ardbeg', 1, 1, 40, 1, 300)`
				)
				.run()
		).toThrow(/UNIQUE constraint failed/);
		// Archived with its factors still set.
		expect(() =>
			sqlite.prepare("UPDATE tasting_bottle SET archived = 1 WHERE id = 'b-nebel'").run()
		).toThrow(/CHECK constraint failed: tasting_bottle_archived_factors/);
		expect(rows("SELECT name FROM sqlite_master WHERE name GLOB '__new_*'")).toEqual([]);

		sqlite.prepare("DELETE FROM tasting WHERE id = 't-autumn'").run();
		expect(rows('SELECT id FROM tasting_bottle')).toEqual([]);
	});
});

describe('migration 0013: distillery variants', () => {
	it('only adds tables: distilleries and research costs stay as they were', () => {
		const sqlite = new Database(':memory:');
		runMigrations(sqlite, realMigrationsUpTo('0012_distillery_research'));
		sqlite
			.prepare(
				`INSERT INTO distillery (name_key, country, country_state, updated_at)
				 VALUES ('stoisha', 'Schottland', 'admin', 100)`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO distillery_research_call (created_at, name_key, stage, model, input_tokens,
				   output_tokens, cache_creation_input_tokens, cache_read_input_tokens,
				   web_search_requests, web_fetch_requests, cost_micro_usd)
				 VALUES (100, 'stoisha', 1, 'claude-opus-5-5', 10, 5, 0, 0, 1, 0, 10140)`
			)
			.run();
		const all = (table: string) => sqlite.prepare(`SELECT * FROM ${table}`).all();
		const before = [all('distillery'), all('distillery_research_call')];

		runMigrations(sqlite, './drizzle');

		expect([all('distillery'), all('distillery_research_call')]).toEqual(before);
		expect(all('distillery_variant_call')).toEqual([]);
		expect(all('distillery_variant_suggestion')).toEqual([]);
	});
});

describe('migration 0014: motto description', () => {
	it('keeps the motto of existing tastings, without a description', () => {
		const sqlite = new Database(':memory:');
		runMigrations(sqlite, realMigrationsUpTo('0013_distillery_variants'));
		sqlite
			.prepare(
				`INSERT INTO tasting (id, slug, name, motto, tasting_date, created_at)
				 VALUES ('t-autumn', 'fluffy-otter', 'Herbst', 'Inselhüpfen', '2026-10-24', 100),
				        ('t-winter', 'bouncy-alpaca', 'Winter', NULL, '2026-12-12', 100)`
			)
			.run();

		runMigrations(sqlite, './drizzle');

		expect(
			sqlite.prepare('SELECT id, motto, motto_description FROM tasting ORDER BY id').all()
		).toEqual([
			{ id: 't-autumn', motto: 'Inselhüpfen', motto_description: null },
			{ id: 't-winter', motto: null, motto_description: null }
		]);
	});
});
