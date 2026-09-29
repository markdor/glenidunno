// One-off dev tool: deletes the local SQLite DB and the presentation media
// directory. Used by `npm run dev:init` right before `db:seed` + `dev`, to
// start the next `db:seed` from a completely clean slate (schema included –
// db:seed re-runs the migrations on the now-missing DB file).
//
// Local dev only, never wired into Docker/CI: it only makes sense to nuke a
// throwaway database. As a guard against a misconfigured environment turning
// this into "delete something outside the project", it refuses to touch
// anything that doesn't resolve to a plain relative path – both DB_PATH and
// MEDIA_PATH are absolute (/data, /media) in the Docker-oriented .env and
// only become relative once .env.local is set up (see .env.local.example).

import { rmSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { resolveDevEnv } from './devEnv.ts';

function assertLocalDevPath(path: string, envVar: string): void {
	const trimmed = path.trim();
	if (trimmed === '' || trimmed === '.' || isAbsolute(trimmed)) {
		throw new Error(
			`refusing to delete ${envVar}="${path}": doesn't look like a local dev path. ` +
				`Copy .env.local.example to .env.local first (it points ${envVar} at a relative, ` +
				`project-local path) before running dev:init.`
		);
	}
}

const { dbPath, mediaPath } = resolveDevEnv();

assertLocalDevPath(dbPath, 'DB_PATH');
assertLocalDevPath(mediaPath, 'MEDIA_PATH');

if (dbPath !== ':memory:') {
	for (const suffix of ['', '-wal', '-shm', '-journal']) {
		rmSync(dbPath + suffix, { force: true });
	}
}
rmSync(mediaPath, { recursive: true, force: true });

console.log(`Removed ${dbPath} (+ WAL/SHM/journal) and ${mediaPath}.`);
