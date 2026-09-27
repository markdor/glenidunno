// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { auth } from '$lib/server/auth';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: (typeof auth.$Infer.Session)['user'] | null;
			session: (typeof auth.$Infer.Session)['session'] | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// Injected at build time via Vite `define` (see vite.config.ts).
	const __APP_VERSION__: string;
}

export {};
