import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from '$env/dynamic/private';
import { logger } from '$lib/server/logger';
import * as schema from './schema';
import { bootstrapAdmin } from './bootstrap';
import { runMigrations } from './migrate';

// Plain filesystem path for better-sqlite3. In Docker this points at the
// named volume (/data/glenidunno.db); falls back to a local file for dev.
const dbPath = env.DB_PATH ?? './glenidunno.db';

if (dbPath !== ':memory:') {
	mkdirSync(dirname(dbPath), { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');

// Boot order: migrate -> admin bootstrap -> (SvelteKit server starts after this
// module finishes evaluating). Drizzle skips already-applied migrations.
// runMigrations() leaves foreign keys switched on (see migrate.ts for why they
// must be off while migrating).
runMigrations(sqlite, './drizzle');
logger.info({ dbPath }, 'database migrations applied');

export const db = drizzle(sqlite, { schema });

bootstrapAdmin(db, { email: env.ADMIN_EMAIL, username: env.ADMIN_USERNAME });

export { schema };
