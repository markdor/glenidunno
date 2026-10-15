import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockEnv = vi.hoisted((): Record<string, string | undefined> => ({}));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import { logger } from './logger';
import {
	CONVERSION_TIMEOUT_MS,
	convertInBackground,
	discardPdf,
	ensurePdf,
	MAX_PDF_BYTES,
	needsConversion,
	StalePdfError
} from './presentationPdf';

const DECK = 'Tasting_2026-10-24_Nebel.pptx';
const PDF = '%PDF-1.7 converted';

let mediaDir: string;
const cacheDir = () => join(mediaDir, 'pdf-cache');
const cached = (file = DECK) => join(cacheDir(), `${file}.pdf`);

beforeEach(async () => {
	mediaDir = await mkdtemp(join(tmpdir(), 'glenidunno-media-'));
	mockEnv.MEDIA_PATH = mediaDir;
	mockEnv.GOTENBERG_URL = 'http://gotenberg.test/';
	await writeFile(join(mediaDir, DECK), 'deck bytes');
	vi.clearAllMocks();
});

afterEach(async () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	// A new generation: nothing a test left behind is joined by the next one.
	await discardPdf(DECK);
	await rm(mediaDir, { recursive: true, force: true });
});

function pdfResponse(body: BodyInit = PDF, headers: Record<string, string> = {}) {
	return new Response(body, { headers: { 'content-type': 'application/pdf', ...headers } });
}

/** A stand-in for Gotenberg answering with whatever `answer` returns. */
function gotenberg(answer: (init?: RequestInit) => Response | Promise<Response>) {
	return vi.fn((_url: string | URL | Request, init?: RequestInit) => Promise.resolve(answer(init)));
}

/** A Gotenberg that answers only once the test calls `respond`. */
function slowGotenberg() {
	let respond!: (response: Response) => void;
	const fetchImpl = gotenberg(() => new Promise<Response>((resolve) => (respond = resolve)));
	return { fetchImpl, respond: (response: Response) => respond(response) };
}

describe('needsConversion', () => {
	it('converts office files only – PDFs are shown as they are', () => {
		expect(needsConversion(DECK)).toBe(true);
		expect(needsConversion('Tasting_2026-10-24_Nebel.odt')).toBe(true);
		expect(needsConversion('Tasting_2026-10-24_Nebel.pdf')).toBe(false);
		expect(needsConversion('Tasting_2026-10-24_Nebel.zip')).toBe(false);
		expect(needsConversion('Tasting_2026-10-24_Nebel')).toBe(false);
	});
});

describe('ensurePdf', () => {
	it('converts the file with Gotenberg under its stored name and caches the PDF', async () => {
		const fetchImpl = gotenberg(() => pdfResponse());

		expect(await ensurePdf(DECK, fetchImpl)).toBe(cached());

		expect(await readFile(cached(), 'utf8')).toBe(PDF);
		// The temporary file is gone, only the PDF is left.
		expect(await readdir(cacheDir())).toEqual([`${DECK}.pdf`]);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('http://gotenberg.test/forms/libreoffice/convert');
		expect(init?.method).toBe('POST');
		const sent = (init?.body as FormData).get('files') as File;
		expect(sent.name).toBe(DECK);
		expect(await sent.text()).toBe('deck bytes');
	});

	it('serves the cache without asking Gotenberg again', async () => {
		await ensurePdf(
			DECK,
			gotenberg(() => pdfResponse())
		);
		const again = gotenberg(() => pdfResponse());

		expect(await ensurePdf(DECK, again)).toBe(cached());
		expect(again).not.toHaveBeenCalled();
	});

	it('converts a file only once for simultaneous requests', async () => {
		const { fetchImpl, respond } = slowGotenberg();
		const first = ensurePdf(DECK, fetchImpl);
		const second = ensurePdf(DECK, fetchImpl);
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());

		respond(pdfResponse());

		expect(await Promise.all([first, second])).toEqual([cached(), cached()]);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('drops the result if the file changed during the conversion', async () => {
		const { fetchImpl, respond } = slowGotenberg();
		const outdated = ensurePdf(DECK, fetchImpl);
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());

		// E.g. the tasting was deleted and a new bottle got the same name.
		await discardPdf(DECK);
		const fresh = gotenberg(() => pdfResponse('%PDF new'));
		expect(await ensurePdf(DECK, fresh)).toBe(cached());

		respond(pdfResponse('%PDF old'));
		await expect(outdated).rejects.toBeInstanceOf(StalePdfError);
		// The new content was converted on its own and survives the old result.
		expect(fresh).toHaveBeenCalledTimes(1);
		expect(await readFile(cached(), 'utf8')).toBe('%PDF new');
		expect(await readdir(cacheDir())).toEqual([`${DECK}.pdf`]);
	});

	it('gives up after the timeout', async () => {
		vi.useFakeTimers();
		const fetchImpl = vi.fn(
			(_url: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
				})
		);
		const pending = ensurePdf(DECK, fetchImpl);
		const rejected = expect(pending).rejects.toThrow('timed out');
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());

		await vi.advanceTimersByTimeAsync(CONVERSION_TIMEOUT_MS);

		await rejected;
		expect(existsSync(cacheDir())).toBe(false);
	});

	it('rejects a PDF above the limit, announced or streamed', async () => {
		const announced = gotenberg(() =>
			pdfResponse(PDF, { 'content-length': String(MAX_PDF_BYTES + 1) })
		);
		await expect(ensurePdf(DECK, announced)).rejects.toThrow('too large');

		const streamed = gotenberg(() =>
			pdfResponse(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array(MAX_PDF_BYTES + 1));
						controller.close();
					}
				})
			)
		);
		await expect(ensurePdf(DECK, streamed)).rejects.toThrow('larger than');
		expect(existsSync(cached())).toBe(false);
		expect(await readdir(cacheDir())).toEqual([]);
	});

	it('never caches what Gotenberg answers with an error or without a PDF', async () => {
		const failing = gotenberg(() => new Response('LibreOffice failed', { status: 503 }));
		await expect(ensurePdf(DECK, failing)).rejects.toThrow('503');

		const html = gotenberg(
			() => new Response('<html>', { headers: { 'content-type': 'text/html' } })
		);
		await expect(ensurePdf(DECK, html)).rejects.toThrow('text/html');

		expect(existsSync(cacheDir())).toBe(false);
	});

	it('needs GOTENBERG_URL and an office file in the scheme', async () => {
		const fetchImpl = gotenberg(() => pdfResponse());
		await expect(ensurePdf('Tasting_2026-10-24_Nebel.pdf', fetchImpl)).rejects.toThrow(
			'no convertible'
		);
		await expect(ensurePdf('../Tasting_2026-10-24_Nebel.pptx', fetchImpl)).rejects.toThrow(
			'no convertible'
		);

		delete mockEnv.GOTENBERG_URL;
		await expect(ensurePdf(DECK, fetchImpl)).rejects.toThrow('GOTENBERG_URL');
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

describe('discardPdf', () => {
	it('deletes the cached PDF and never creates the folder', async () => {
		await discardPdf(DECK);
		expect(existsSync(cacheDir())).toBe(false);

		await ensurePdf(
			DECK,
			gotenberg(() => pdfResponse())
		);
		await discardPdf(DECK);
		expect(await readdir(cacheDir())).toEqual([]);
	});

	it('ignores names outside the scheme', async () => {
		await expect(discardPdf('.upload-0f6e8f43-6bb5-4f4c-9d8a-7d8f4b1c2e3a')).resolves.toBe(
			undefined
		);
		await expect(discardPdf('../victim.txt')).resolves.toBe(undefined);
	});
});

describe('convertInBackground', () => {
	it('converts an office file without being awaited', async () => {
		const fetchImpl = gotenberg(() => pdfResponse());
		vi.stubGlobal('fetch', fetchImpl);

		convertInBackground(DECK);
		await vi.waitFor(() => expect(existsSync(cached())).toBe(true));

		// Original PDFs and other files need nothing.
		convertInBackground('Tasting_2026-10-24_Nebel.pdf');
		convertInBackground('Tasting_2026-10-24_Nebel.zip');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('only logs a failure', async () => {
		vi.stubGlobal(
			'fetch',
			gotenberg(() => new Response('', { status: 500 }))
		);

		convertInBackground(DECK);

		await vi.waitFor(() =>
			expect(logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ file: DECK }),
				'presentation conversion failed'
			)
		);
	});

	it('logs a result dropped after a file change as info only', async () => {
		const { fetchImpl, respond } = slowGotenberg();
		vi.stubGlobal('fetch', fetchImpl);
		convertInBackground(DECK);
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());

		await discardPdf(DECK);
		respond(pdfResponse());

		await vi.waitFor(() => expect(logger.info).toHaveBeenCalled());
		expect(logger.error).not.toHaveBeenCalled();
		expect(existsSync(cached())).toBe(false);
	});

	it('skips the conversion without GOTENBERG_URL (local development)', () => {
		const fetchImpl = gotenberg(() => pdfResponse());
		vi.stubGlobal('fetch', fetchImpl);
		delete mockEnv.GOTENBERG_URL;

		convertInBackground(DECK);

		expect(fetchImpl).not.toHaveBeenCalled();
		expect(logger.debug).toHaveBeenCalled();
	});
});
