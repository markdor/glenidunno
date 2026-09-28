import { rmSync } from 'node:fs';

// Wipe any leftover E2E SQLite files so each run boots a clean DB (fresh
// migrations + admin bootstrap), plus the magic-link capture file and the
// uploaded presentations. The paths match DB_PATH / MAGIC_LINK_DEBUG_PATH /
// MEDIA_PATH in playwright.config.ts.
//
// Runs as the first part of the webServer command, not as Playwright
// globalSetup: Playwright starts the webServer *before* globalSetup, so the
// preview server would already hold the old e2e.db open. On Windows the delete
// then fails and the run inherits the previous run's state, e.g. the magic-link
// quota the rate-limit test used up. No try/catch on purpose: `force` already
// ignores missing files, anything else (a locked DB) should fail the run loudly.
const E2E_DB_FILES = [
	'./e2e.db',
	'./e2e.db-shm',
	'./e2e.db-wal',
	'./e2e.db-journal',
	'./e2e-magic-link.log',
	// Presentation uploads (MEDIA_PATH in playwright.config.ts).
	'./e2e-media'
];

for (const f of E2E_DB_FILES) {
	rmSync(f, { force: true, recursive: true });
}
