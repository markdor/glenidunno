import pino from 'pino';
import pretty from 'pino-pretty';
import { dev } from '$app/environment';

// pino-pretty runs as a stream in the main thread, not as a transport: a transport
// writes UTF-8 bytes from its worker straight to file descriptor 1, which a Windows
// console decodes with its OEM code page ("ä" turns into "├ñ"). process.stdout
// converts the text for the console instead.
export const logger = dev
	? pino({ level: 'debug' }, pretty({ destination: process.stdout }))
	: pino({ level: 'info' });
