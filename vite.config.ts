import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version)
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	test: {
		// Any accidental import of the real DB layer during tests stays in memory.
		env: { DB_PATH: ':memory:' },
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov', 'html', 'json', 'json-summary'],
			include: ['src/**/*.{ts,svelte}'],
			exclude: [
				'src/**/*.{test,spec}.{js,ts}',
				'src/**/*.e2e.ts',
				'src/app.d.ts',
				'src/routes/+layout.svelte',
				// Wiring / config / module-init side effects — exercised via e2e, not units.
				'src/hooks.server.ts',
				'src/lib/server/auth.ts',
				'src/lib/server/db/index.ts',
				'src/lib/server/logger.ts',
				'src/lib/auth-client.ts'
			],
			thresholds: {
				lines: 85,
				statements: 85,
				functions: 85,
				branches: 85
			}
		},
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
