import { existsSync, readFileSync } from 'node:fs';

// Mirrors the E2E_TARGET flag set in playwright.docker.config.ts. The local
// run (vite preview on the host) writes the capture file directly; the
// docker run only sees it via the bind mount declared in compose.e2e.yaml.
const isContainerRun = process.env.E2E_TARGET === 'docker';

// Must match MAGIC_LINK_DEBUG_PATH in playwright.config.ts (local) resp. the
// container path bind-mounted by compose.e2e.yaml (docker).
export const MAGIC_LINK_FILE = isContainerRun
	? './.e2e-docker/magic-link.log'
	: './e2e-magic-link.log';

export const E2E_ADMIN_EMAIL = 'admin@e2e.test';

// Must match the relaxed `emailRateLimit` override in src/lib/server/auth.ts,
// which only applies while MAGIC_LINK_DEBUG_PATH is set (i.e. in e2e runs).
// Duplicated rather than imported: these tests talk to the app strictly as a
// black box over HTTP and the capture file, never via its server modules.
export const MAGIC_LINK_EMAIL_TEST_LIMIT = 20;

function readMagicLinkLines(): string[] {
	if (!existsSync(MAGIC_LINK_FILE)) return [];
	return readFileSync(MAGIC_LINK_FILE, 'utf8')
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);
}

// The capture file is shared for the whole run (auth.setup.ts logs in once,
// and any other test that logs in again, e.g. auth-login.e2e.ts, appends to
// the same file) — "the last line" alone can't tell a fresh request apart
// from an already-consumed one from an earlier login. Read this *before*
// triggering a new request, then pass it to waitForNewMagicLink.
export function countMagicLinkLines(): number {
	return readMagicLinkLines().length;
}

export async function waitForNewMagicLink(previousLineCount: number): Promise<string> {
	for (let i = 0; i < 30; i++) {
		const lines = readMagicLinkLines();
		if (lines.length > previousLineCount) return lines[lines.length - 1];
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error('Neue Magic-Link-URL sollte in der Capture-Datei landen');
}
