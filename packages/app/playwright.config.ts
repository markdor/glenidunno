import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		// Reset before the server starts – see playwright.reset-e2e.ts for why
		// this can't be a globalSetup.
		command: 'node playwright.reset-e2e.ts && npm run build && npm run preview',
		port: 4173,
		env: {
			BASE_URL: 'http://localhost:4173',
			AUTH_SECRET: 'e2e-test-secret-please-do-not-deploy-anywhere',
			// Host-side SQLite file (admin bootstrap, whitelist) lives here.
			DB_PATH: './e2e.db',
			// Tokens are stored hashed, so the plaintext magic-link URL is captured
			// here instead of read back from the DB (see playwright.reset-e2e.ts).
			MAGIC_LINK_DEBUG_PATH: './e2e-magic-link.log',
			// Admin gets bootstrapped into the user table on boot -> whitelisted,
			// so this address may request a magic link.
			ADMIN_EMAIL: 'admin@e2e.test',
			ADMIN_USERNAME: 'admin'
		}
	},
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
