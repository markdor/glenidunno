import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '$env/dynamic/private';
import { logger } from './logger';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
	if (transporter) return transporter;

	const host = env.SMTP_HOST;
	const port = Number(env.SMTP_PORT ?? '465');
	const user = env.SMTP_USER;
	const pass = env.SMTP_PASS;

	if (!host || !user || !pass) {
		throw new Error(
			'SMTP not configured: SMTP_HOST, SMTP_USER and SMTP_PASS are required to send mail'
		);
	}

	transporter = nodemailer.createTransport({
		host,
		port,
		secure: port === 465,
		auth: { user, pass }
	});
	return transporter;
}

export async function sendMagicLinkMail(email: string, url: string): Promise<void> {
	const from = env.SMTP_FROM ?? env.SMTP_USER;
	if (!from) {
		throw new Error('SMTP_FROM or SMTP_USER must be set as the sender address');
	}

	const info = await getTransporter().sendMail({
		from,
		to: email,
		subject: 'Dein Login-Link für Glen Idunno',
		text:
			`Klicke auf den folgenden Link, um dich bei Glen Idunno anzumelden. ` +
			`Der Link ist 24 Stunden gültig und kann einmal verwendet werden.\n\n${url}\n\n` +
			`Falls du das nicht angefordert hast, kannst du diese E-Mail ignorieren.`,
		html:
			`<p>Klicke auf den folgenden Link, um dich bei Glen Idunno anzumelden. ` +
			`Der Link ist 24 Stunden gültig und kann einmal verwendet werden.</p>` +
			`<p><a href="${url}">Bei Glen Idunno anmelden</a></p>` +
			`<p>Falls du das nicht angefordert hast, kannst du diese E-Mail ignorieren.</p>`
	});

	logger.info({ messageId: info.messageId, email }, 'magic link email sent');
}
