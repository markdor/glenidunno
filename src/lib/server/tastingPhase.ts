import {
	TASTING_ORDER_HOUR,
	TASTING_REVEAL_HOUR,
	TASTING_TIME_ZONE,
	type TastingPhase
} from '$lib/tasting';

// hourCycle 'h23' so midnight is "00" (hour12: false may yield "24").
const berlinFormat = new Intl.DateTimeFormat('en-CA', {
	timeZone: TASTING_TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	hourCycle: 'h23'
});

/**
 * Calendar date (`YYYY-MM-DD`) and hour of `now` in Berlin local time. Works
 * independently of the process time zone (the container runs in UTC) and
 * covers daylight saving time via Intl.
 */
export function getBerlinDateTime(now: Date): { date: string; hour: number } {
	const parts = Object.fromEntries(berlinFormat.formatToParts(now).map((p) => [p.type, p.value]));
	return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Today's calendar date in Berlin, the reference for "not in the past". */
export function getBerlinToday(now: Date): string {
	return getBerlinDateTime(now).date;
}

// Pure calendar arithmetic on a `YYYY-MM-DD` date, no time zone involved.
function nextDay(date: string): string {
	const [year, month, day] = date.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * Phase of a tasting at `now`. The server always decides; the client clock
 * plays no role. `YYYY-MM-DD` strings compare correctly as plain strings.
 */
export function getTastingPhase(tastingDate: string, now: Date): TastingPhase {
	const { date, hour } = getBerlinDateTime(now);
	if (date < tastingDate || (date === tastingDate && hour < TASTING_ORDER_HOUR)) return 'entry';

	const revealDate = nextDay(tastingDate);
	if (date < revealDate || (date === revealDate && hour < TASTING_REVEAL_HOUR)) return 'order';

	return 'revealed';
}
