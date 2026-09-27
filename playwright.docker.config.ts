import { defineConfig } from '@playwright/test';

// Flags container runs so tests/helpers know to read the magic-link capture
// file from its bind-mounted location (see tests/e2e/magic-link.ts) instead
// of the host-side path used by the local vite-preview run. Worker processes
// inherit this from the runner's env.
process.env.E2E_TARGET = 'docker';

// Runs the e2e suite against the production-like container from compose.yaml
// + compose.e2e.yaml instead of the Vite preview server.
// compose.e2e.yaml points the app at an isolated DB volume (wiped via
// `down -v` before every run) and bind-mounts the magic-link capture file so
// the auth.setup.ts project can log in from the host like it does locally.
// Keep the URL in sync with BASE_URL in compose.e2e.yaml.
const baseURL = 'http://127.0.0.1:3000';
const composeCmd = 'docker compose -f compose.yaml -f compose.e2e.yaml';

export default defineConfig({
	globalSetup: './playwright.docker.global-setup.ts',
	webServer: {
		command: `${composeCmd} down -v && ${composeCmd} up --build --force-recreate`,
		url: baseURL,
		reuseExistingServer: false,
		timeout: 180_000
	},
	use: { baseURL },
	projects: [
		{ name: 'setup', testMatch: /auth\.setup\.ts/ },
		{
			name: 'e2e',
			testMatch: '**/*.e2e.{ts,js}',
			dependencies: ['setup'],
			use: { storageState: 'playwright/.auth/admin.json' }
		}
	]
});
