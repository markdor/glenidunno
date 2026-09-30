import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockEnv = vi.hoisted((): Record<string, string | undefined> => ({}));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import { TASTING_PRESENTATION_MAX_BYTES } from '$lib/validation';
import { logger } from './logger';
import {
	applyFileChanges,
	checkPresentationUpload,
	presentationResponse,
	stageUpload
} from './tastingMedia';

let mediaDir: string;

beforeEach(async () => {
	// A fresh directory per test; stageUpload has to create "media" itself.
	mediaDir = join(await mkdtemp(join(tmpdir(), 'glenidunno-media-')), 'media');
	mockEnv.MEDIA_PATH = mediaDir;
	vi.clearAllMocks();
});

afterEach(async () => {
	await rm(join(mediaDir, '..'), { recursive: true, force: true });
});

const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 1, 2, 255]);
const NAME = 'Tasting_2026-10-24_Nebel.pptx';

describe('checkPresentationUpload', () => {
	it('treats a missing or empty file input as "no new presentation"', () => {
		expect(checkPresentationUpload(null)).toEqual({ upload: null, error: null });
		expect(checkPresentationUpload('text')).toEqual({ upload: null, error: null });
		expect(checkPresentationUpload(new File([], ''))).toEqual({ upload: null, error: null });
	});

	it('accepts a file up to the limit', () => {
		const file = new File([new Uint8Array(TASTING_PRESENTATION_MAX_BYTES)], 'deck.pptx');
		expect(checkPresentationUpload(file)).toEqual({ upload: file, error: null });
	});

	it('rejects a file above the limit and overlong file names', () => {
		const tooLarge = new File([new Uint8Array(TASTING_PRESENTATION_MAX_BYTES + 1)], 'deck.pptx');
		expect(checkPresentationUpload(tooLarge)).toEqual({ upload: null, error: 'invalid' });
		const longName = new File([bytes], `${'x'.repeat(252)}.pptx`);
		expect(checkPresentationUpload(longName)).toEqual({ upload: null, error: 'invalid' });
	});
});

describe('stageUpload', () => {
	it('writes the upload byte for byte to a temporary file', async () => {
		const pending = await stageUpload(new File([bytes], 'Ardbeg Uigeadail.PPTX'));

		expect(pending).toMatchObject({ name: 'Ardbeg Uigeadail.PPTX', extension: '.pptx' });
		expect(pending.tempFile).toMatch(/^\.upload-[0-9a-f-]{36}$/);
		expect(new Uint8Array(await readFile(join(mediaDir, pending.tempFile)))).toEqual(bytes);
	});

	it('strips client path parts from the original name', async () => {
		const pending = await stageUpload(new File([bytes], '..\\..\\evil/../deck.$(rm)'));
		expect(pending).toMatchObject({ name: 'deck.$(rm)', extension: '' });
	});

	it('gives a nameless upload a neutral name', async () => {
		expect((await stageUpload(new File([bytes], ' '))).name).toBe('Praesentation');
	});
});

describe('applyFileChanges', () => {
	it('moves a staged upload to its final name and deletes files', async () => {
		const pending = await stageUpload(new File([bytes], 'deck.pptx'));
		await writeFile(join(mediaDir, 'Tasting_2026-10-24_Alt.pdf'), 'old');

		await applyFileChanges([
			{ move: pending.tempFile, to: NAME },
			{ delete: 'Tasting_2026-10-24_Alt.pdf' }
		]);

		expect(await readdir(mediaDir)).toEqual([NAME]);
		expect(new Uint8Array(await readFile(join(mediaDir, NAME)))).toEqual(bytes);
	});

	it('replaces an existing file of the same name', async () => {
		const first = await stageUpload(new File(['first'], 'a.pptx'));
		await applyFileChanges([{ move: first.tempFile, to: NAME }]);
		const second = await stageUpload(new File(['second'], 'b.pptx'));
		await applyFileChanges([{ move: second.tempFile, to: NAME }]);

		expect(await readFile(join(mediaDir, NAME), 'utf8')).toBe('second');
	});

	it('never touches names outside the scheme and never throws', async () => {
		const victim = join(mediaDir, '..', 'victim.txt');
		await writeFile(victim, 'keep me');

		await applyFileChanges([
			{ delete: '../victim.txt' },
			{ move: 'Tasting_2026-10-24_Missing.pptx', to: NAME }
		]);

		expect(existsSync(victim)).toBe(true);
		expect(logger.error).toHaveBeenCalledTimes(2);
	});

	it('ignores deleting a file that is already gone', async () => {
		await applyFileChanges([{ delete: NAME }]);
		expect(logger.error).not.toHaveBeenCalled();
	});
});

describe('presentationResponse', () => {
	it('serves the file as a download that never renders in the browser', async () => {
		const pending = await stageUpload(new File([bytes], 'x'));
		await applyFileChanges([{ move: pending.tempFile, to: NAME }]);

		const response = (await presentationResponse({ file: NAME, name: 'Äpfel & "Birnen".pptx' }))!;

		expect(response.status).toBe(200);
		expect(Object.fromEntries(response.headers)).toMatchObject({
			'content-type': 'application/octet-stream',
			'content-length': String(bytes.length),
			'content-disposition':
				'attachment; filename="_pfel & _Birnen_.pptx"; ' +
				"filename*=UTF-8''%C3%84pfel%20%26%20%22Birnen%22.pptx",
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox"
		});
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
	});

	it('returns null if the file is missing or the name is not a scheme name', async () => {
		expect(await presentationResponse({ file: NAME, name: 'x' })).toBeNull();
		expect(await presentationResponse({ file: '../etc/passwd', name: 'x' })).toBeNull();
	});
});
