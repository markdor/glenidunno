// One-off dev tool: resets the local SQLite DB to a single, fixed whisky
// tasting ("Testitest") for manual testing and UI development. Run via
// `npm run db:seed` before `npm run dev`/`npm run preview`.
//
// Wipes ALL existing tasting data (cascades to participants and bottles) and
// replaces it with the fixed dataset below. Participants are users: the admin
// from .env (ADMIN_EMAIL/ADMIN_USERNAME – so the tasting link opens after
// logging in as the admin) plus two users under the undeliverable
// dummy-<n>@dummy.invalid, upserted on their email like the admin bootstrap
// does. Sessions and accounts are left untouched, so the admin login keeps
// working. The tasting date is always "today + 7 days" and neither manual
// override is set, so it's reliably in phase `entry` (getTastingPhase() in
// tastingPhase.ts) right after seeding: bottles are already filled in, but
// order/reveal aren't opened yet – exercise those from the admin UI by hand.
//
// Not seeded: presentation uploads (two of the original bottles had one) –
// there's no fixture file to attach, so presentation_file/presentation_name
// stay null here.
//
// Plain `node` (not vite-node/tsx): Node >=24 runs this .ts file directly,
// so relative imports into src/ (which drop file extensions, relying on
// Vite's bundler resolution) would break under Node's stricter ESM loader.
// The script stays self-contained and only uses bare package imports.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolveDevEnv } from './devEnv.ts';

const { dbPath, baseUrl, adminEmail, adminUsername } = resolveDevEnv();

if (!adminEmail || !adminUsername) {
	throw new Error(
		'ADMIN_EMAIL and ADMIN_USERNAME must be set (.env): the admin takes part in the seeded ' +
			'tasting, so its link can be opened after logging in.'
	);
}

if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');

// Foreign keys off while migrating, like runMigrations() in
// src/lib/server/db/migrate.ts: drizzle runs all pending migrations in one
// transaction, where a table rebuild's DROP TABLE would otherwise cascade.
sqlite.pragma('foreign_keys = OFF');
migrate(drizzle(sqlite), { migrationsFolder: './drizzle' });
sqlite.pragma('foreign_keys = ON');

function toUnixSeconds(date: Date): number {
	return Math.floor(date.getTime() / 1000);
}

const now = new Date();
const tastingDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

type SeedBottle = {
	slot: number;
	alias: string;
	distillery: string;
	bottler: string | null;
	bottling: string | null;
	age: number | null;
	smoke: number;
	cask: number;
	abv: number;
	value: number;
};

type SeedParticipant = {
	/** The admin from .env, or a seeded user with this username. */
	user: 'admin' | { username: string; email: string };
	bottles: SeedBottle[];
};

// Real content of the "Testitest" tasting, captured once and frozen here.
const PARTICIPANTS: SeedParticipant[] = [
	{
		user: 'admin',
		bottles: [
			{
				slot: 1,
				alias: 'M1',
				distillery: 'Laphi',
				bottler: null,
				bottling: null,
				age: 10,
				smoke: 5,
				cask: 1,
				abv: 46,
				value: 2
			},
			{
				slot: 2,
				alias: 'M2',
				distillery: 'Kilchoman',
				bottler: 'Gordon & MacPhail',
				bottling: 'Best Coice',
				age: 17,
				smoke: 3,
				cask: 4,
				abv: 54.2,
				value: 5
			}
		]
	},
	{
		user: { username: 'Josh', email: 'dummy-1@dummy.invalid' },
		bottles: [
			{
				slot: 1,
				alias: 'J1',
				distillery: 'Hmpf',
				bottler: 'Blubb',
				bottling: null,
				age: 7,
				smoke: 1,
				cask: 3,
				abv: 63,
				value: 2
			},
			{
				slot: 2,
				alias: 'J2',
				distillery: 'Potzblitz',
				bottler: null,
				bottling: null,
				age: null,
				smoke: 5,
				cask: 0,
				abv: 75,
				value: 1
			}
		]
	},
	{
		user: { username: 'Patrick', email: 'dummy-2@dummy.invalid' },
		bottles: [
			{
				slot: 1,
				alias: 'P121',
				distillery: 'Hilfe',
				bottler: null,
				bottling: 'nix',
				age: null,
				smoke: 2,
				cask: 2,
				abv: 41.3,
				value: 2
			},
			{
				slot: 2,
				alias: 'P122',
				distillery: 'Taiwin',
				bottler: null,
				bottling: null,
				age: null,
				smoke: 5,
				cask: 4,
				abv: 44,
				value: 3
			}
		]
	}
];

sqlite.prepare('DELETE FROM tasting').run(); // cascades to participants/bottles/write-throttle

// Upsert on the email like the admin bootstrap (src/lib/server/db/bootstrap.ts),
// so the admin row is the one the app bootstraps on start. A seeded user is
// always active – a deactivation from earlier manual testing is lifted.
const upsertUser = sqlite.prepare(
	`INSERT INTO user (id, name, email, email_verified, created_at, updated_at, username, is_admin)
	 VALUES (@id, @username, @email, 1, @now, @now, @username, @isAdmin)
	 ON CONFLICT (email) DO UPDATE SET
	   is_admin = max(is_admin, excluded.is_admin), deactivated_at = NULL, updated_at = excluded.updated_at
	 RETURNING id`
);

function seedUser(user: SeedParticipant['user']): string {
	const { username, email, isAdmin } =
		user === 'admin'
			? { username: adminUsername!, email: adminEmail!, isAdmin: 1 }
			: { ...user, isAdmin: 0 };
	const row = upsertUser.get({
		id: randomUUID(),
		username,
		email,
		isAdmin,
		now: toUnixSeconds(now)
	});
	return (row as { id: string }).id;
}

// A free random <adjective>-<animal> – after the DELETE above, all are free.
const slug = sqlite
	.prepare(
		`SELECT a.word || '-' || n.word FROM tasting_slug_adjective a
		 CROSS JOIN tasting_slug_animal n
		 WHERE a.word || '-' || n.word NOT IN (SELECT slug FROM tasting)
		 ORDER BY random() LIMIT 1`
	)
	.pluck()
	.get() as string;

const tastingId = randomUUID();
sqlite
	.prepare(
		`INSERT INTO tasting
		   (id, slug, name, tasting_date, bottles_per_participant, created_at, order_opened_at,
		    revealed_at)
		 VALUES
		   (@id, @slug, @name, @tastingDate, @bottlesPerParticipant, @createdAt, @orderOpenedAt,
		    @revealedAt)`
	)
	.run({
		id: tastingId,
		slug,
		name: 'Testitest',
		tastingDate,
		bottlesPerParticipant: 2,
		createdAt: toUnixSeconds(now),
		// No manual override: with tastingDate a week out, getTastingPhase()
		// resolves to `entry` purely from the clock.
		orderOpenedAt: null,
		revealedAt: null
	});

const insertParticipant = sqlite.prepare(
	`INSERT INTO tasting_participant (id, tasting_id, user_id, created_at)
	 VALUES (@id, @tastingId, @userId, @createdAt)`
);
const insertBottle = sqlite.prepare(
	`INSERT INTO tasting_bottle
	   (id, participant_id, slot, alias, distillery, bottler, bottling, age, whiskybase_url,
	    smoke, cask, abv, value, updated_at, presentation_file, presentation_name)
	 VALUES
	   (@id, @participantId, @slot, @alias, @distillery, @bottler, @bottling, @age, NULL,
	    @smoke, @cask, @abv, @value, @updatedAt, NULL, NULL)`
);

for (const participant of PARTICIPANTS) {
	const participantId = randomUUID();

	insertParticipant.run({
		id: participantId,
		tastingId,
		userId: seedUser(participant.user),
		createdAt: toUnixSeconds(now)
	});

	for (const bottle of participant.bottles) {
		insertBottle.run({
			id: randomUUID(),
			participantId,
			slot: bottle.slot,
			alias: bottle.alias,
			distillery: bottle.distillery,
			bottler: bottle.bottler,
			bottling: bottle.bottling,
			age: bottle.age,
			smoke: bottle.smoke,
			cask: bottle.cask,
			abv: bottle.abv,
			value: bottle.value,
			updatedAt: toUnixSeconds(now)
		});
	}
}

sqlite.close();

console.log(
	`Seeded tasting "Testitest" (${tastingId}) into ${dbPath} – tasting date ${tastingDate}, phase: entry.
`
);
console.log(
	`Tasting link (log in as ${adminEmail}; the slug is new on every run):
  ${new URL(`/tasting/${slug}`, baseUrl).href}`
);
