// Shared local-dev environment resolution for scripts/*.ts (seed, reset).
// These run via plain `node`, not Vite, so they have to replicate Vite's own
// .env / .env.local precedence (see .env.local.example) by hand.

import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';

export type DevEnv = {
	dbPath: string;
	mediaPath: string;
	baseUrl: string;
	/** The bootstrapped admin, normalized like db/bootstrap.ts does. */
	adminEmail: string | undefined;
	adminUsername: string | undefined;
};

/**
 * Loads .env, then .env.local on top (Vite gives it precedence for
 * `npm run dev`). A variable already present in the real environment (e.g.
 * `DB_PATH=... npm run db:seed`, or a container's actual env) always wins
 * over both files – `override: true` on the .env.local load would otherwise
 * clobber it too, not just the value from .env – so it's snapshotted first
 * and restored after.
 */
export function resolveDevEnv(): DevEnv {
	const explicit = {
		DB_PATH: process.env.DB_PATH,
		MEDIA_PATH: process.env.MEDIA_PATH,
		BASE_URL: process.env.BASE_URL
	};

	// quiet: true suppresses dotenv's own promotional console output.
	loadEnv({ quiet: true });
	if (existsSync('.env.local')) loadEnv({ path: '.env.local', override: true, quiet: true });

	for (const [key, value] of Object.entries(explicit)) {
		if (value !== undefined) process.env[key] = value;
	}

	return {
		dbPath: process.env.DB_PATH ?? './glenidunno.db',
		mediaPath: process.env.MEDIA_PATH ?? './media',
		baseUrl: process.env.BASE_URL ?? 'http://localhost:5173',
		adminEmail: process.env.ADMIN_EMAIL?.trim().toLowerCase() || undefined,
		adminUsername: process.env.ADMIN_USERNAME?.trim() || undefined
	};
}
