import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMail = vi.fn(async () => ({ messageId: 'msg-1' }));
const createTransport = vi.fn(() => ({ sendMail }));

// Mocked fns have a zero-arg signature, so the call tuples need a cast to read args.
const mailArgs = () => sendMail.mock.calls as unknown as Array<[Record<string, unknown>]>;

vi.mock('nodemailer', () => ({
	default: { createTransport },
	createTransport
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

const mockEnv: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
});

async function importMailer() {
	return import('./mailer');
}

describe('sendMagicLinkMail', () => {
	it('throws when no sender address is configured', async () => {
		const { sendMagicLinkMail } = await importMailer();
		await expect(sendMagicLinkMail('a@b.de', 'https://x/y')).rejects.toThrow(
			/SMTP_FROM or SMTP_USER/
		);
	});

	it('throws when the SMTP host/credentials are missing', async () => {
		mockEnv.SMTP_FROM = 'glenidunno@example.de'; // sender ok, transport not configured
		const { sendMagicLinkMail } = await importMailer();
		await expect(sendMagicLinkMail('a@b.de', 'https://x/y')).rejects.toThrow(/SMTP not configured/);
		expect(createTransport).not.toHaveBeenCalled();
	});

	it('creates a secure transport on port 465 and sends the link', async () => {
		Object.assign(mockEnv, {
			SMTP_HOST: 'mail.example.de',
			SMTP_PORT: '465',
			SMTP_USER: 'bot@example.de',
			SMTP_PASS: 'secret',
			SMTP_FROM: 'glenidunno@example.de'
		});
		const { sendMagicLinkMail } = await importMailer();

		await sendMagicLinkMail('user@example.de', 'https://glenidunno/verify?token=abc');

		expect(createTransport).toHaveBeenCalledWith({
			host: 'mail.example.de',
			port: 465,
			secure: true,
			auth: { user: 'bot@example.de', pass: 'secret' }
		});
		const mail = mailArgs()[0][0];
		expect(mail).toMatchObject({ from: 'glenidunno@example.de', to: 'user@example.de' });
		expect(mail.text).toContain('https://glenidunno/verify?token=abc');
		expect(mail.html).toContain('https://glenidunno/verify?token=abc');
		expect(mail.subject).toBe('Dein Login-Link für Glen Idunno');
		expect(mail.text).toContain('Glen Idunno');
		expect(mail.html).toContain('Glen Idunno');
	});

	it('reuses the cached transporter across multiple sends', async () => {
		Object.assign(mockEnv, {
			SMTP_HOST: 'mail.example.de',
			SMTP_PORT: '465',
			SMTP_USER: 'bot@example.de',
			SMTP_PASS: 'secret',
			SMTP_FROM: 'glenidunno@example.de'
		});
		const { sendMagicLinkMail } = await importMailer();

		await sendMagicLinkMail('a@example.de', 'https://x/1');
		await sendMagicLinkMail('b@example.de', 'https://x/2');

		// The transport is built once and reused for the second send.
		expect(createTransport).toHaveBeenCalledTimes(1);
		expect(sendMail).toHaveBeenCalledTimes(2);
	});

	it('falls back to SMTP_USER as the sender when SMTP_FROM is unset', async () => {
		Object.assign(mockEnv, {
			SMTP_HOST: 'mail.example.de',
			SMTP_PORT: '587',
			SMTP_USER: 'bot@example.de',
			SMTP_PASS: 'secret'
		});
		const { sendMagicLinkMail } = await importMailer();

		await sendMagicLinkMail('user@example.de', 'https://glenidunno/verify');

		expect(createTransport).toHaveBeenCalledWith(
			expect.objectContaining({ port: 587, secure: false })
		);
		expect(mailArgs()[0][0]).toMatchObject({ from: 'bot@example.de' });
	});
});
