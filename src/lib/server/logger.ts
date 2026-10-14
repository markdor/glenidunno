import { createRequire } from 'node:module';
import pino from 'pino';
import { dev } from '$app/environment';

// Since pino 10.4 a bare transport target is resolved relative to the synchronous
// call sites (util.getCallSites). Under Vite's SSR module runner the only one left
// is the evaluated module without a usable file name, so pass an absolute path.
export const logger = pino({
	level: dev ? 'debug' : 'info',
	transport: dev ? { target: createRequire(import.meta.url).resolve('pino-pretty') } : undefined
});
