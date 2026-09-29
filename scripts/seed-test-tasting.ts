// One-off dev tool: resets the local SQLite DB to a single, fixed whisky
// tasting ("Testitest") for manual testing and UI development. Run via
// `npm run db:seed` before `npm run dev`/`npm run preview`.
//
// Wipes ALL existing tasting data (cascades to participants and bottles) and
// replaces it with the fixed dataset below – the user/session/account tables
// are left untouched, so the admin login keeps working. The tasting date is
// always "today + 7 days" and neither manual override is set, so it's
// reliably in phase `entry` (getTastingPhase() in tastingPhase.ts) right
// after seeding: bottles are already filled in, but order/reveal aren't
// opened yet – exercise those from the admin UI by hand.
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
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolveDevEnv } from './devEnv.ts';

const { dbPath, baseUrl } = resolveDevEnv();

if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

migrate(drizzle(sqlite), { migrationsFolder: './drizzle' });

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

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
	name: string;
	bottles: SeedBottle[];
};

// Real content of the "Testitest" tasting, captured once and frozen here.
const PARTICIPANTS: SeedParticipant[] = [
	{
		name: 'Markus',
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
		name: 'Josh',
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
		name: 'Patrick',
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

const tastingId = randomUUID();
sqlite
	.prepare(
		`INSERT INTO tasting
		   (id, name, tasting_date, bottles_per_participant, created_at, order_opened_at, revealed_at)
		 VALUES
		   (@id, @name, @tastingDate, @bottlesPerParticipant, @createdAt, @orderOpenedAt, @revealedAt)`
	)
	.run({
		id: tastingId,
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
	`INSERT INTO tasting_participant (id, tasting_id, name, token_hash, created_at)
	 VALUES (@id, @tastingId, @name, @tokenHash, @createdAt)`
);
const insertBottle = sqlite.prepare(
	`INSERT INTO tasting_bottle
	   (id, participant_id, slot, alias, distillery, bottler, bottling, age, whiskybase_url,
	    smoke, cask, abv, value, updated_at, presentation_file, presentation_name)
	 VALUES
	   (@id, @participantId, @slot, @alias, @distillery, @bottler, @bottling, @age, NULL,
	    @smoke, @cask, @abv, @value, @updatedAt, NULL, NULL)`
);

const links: string[] = [];

for (const participant of PARTICIPANTS) {
	const participantId = randomUUID();
	const token = randomBytes(24).toString('base64url');

	insertParticipant.run({
		id: participantId,
		tastingId,
		name: participant.name,
		tokenHash: hashToken(token),
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

	links.push(`  ${participant.name}: ${new URL(`/tasting/${token}`, baseUrl).href}`);
}

sqlite.close();

console.log(
	`Seeded tasting "Testitest" (${tastingId}) into ${dbPath} – tasting date ${tastingDate}, phase: entry.\n`
);
console.log('Participant links (tokens are fresh every run, old ones stop working):');
console.log(links.join('\n'));
