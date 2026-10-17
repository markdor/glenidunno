import {
	TASTING_ORDER_HOUR,
	TASTING_RELEASE_HOUR,
	TASTING_REVEAL_HOUR,
	TASTING_TIME_ZONE,
	type ManualPhaseChanges,
	type TastingPhase
} from '$lib/tasting';

// hourCycle 'h23' so midnight is "00" (hour12: false may yield "24").
const berlinFormat = new Intl.DateTimeFormat('en-CA', {
	timeZone: TASTING_TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hourCycle: 'h23'
});

function berlinParts(now: Date): Record<string, string> {
	return Object.fromEntries(berlinFormat.formatToParts(now).map((p) => [p.type, p.value]));
}

/**
 * Calendar date (`YYYY-MM-DD`) and hour of `now` in Berlin local time. Works
 * independently of the process time zone (the container runs in UTC) and
 * covers daylight saving time via Intl.
 */
export function getBerlinDateTime(now: Date): { date: string; hour: number } {
	const parts = berlinParts(now);
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

// `YYYY-MM-DD` strings compare correctly as plain strings.
function phaseByClock(tastingDate: string, now: Date): TastingPhase {
	const { date, hour } = getBerlinDateTime(now);
	if (date < tastingDate || (date === tastingDate && hour < TASTING_ORDER_HOUR)) return 'entry';

	const revealDate = nextDay(tastingDate);
	if (date < revealDate || (date === revealDate && hour < TASTING_REVEAL_HOUR)) return 'order';

	return 'revealed';
}

/**
 * Phase of a tasting at `now`: by the clock (18:00 on the tasting day, 9:00
 * on the day after), unless the admin moved it forward by hand. Manual
 * changes only ever advance the phase, they never hold it back. The server
 * always decides; the client clock plays no role.
 */
export function getTastingPhase(
	tastingDate: string,
	now: Date,
	manual?: ManualPhaseChanges
): TastingPhase {
	const byClock = phaseByClock(tastingDate, now);
	if (manual?.revealedAt) return 'revealed';
	if (manual?.orderOpenedAt && byClock === 'entry') return 'order';
	return byClock;
}

/**
 * Whether a tasting is released for the distillery research: revealed (by the
 * clock or by the admin's button) or its day has reached TASTING_RELEASE_HOUR.
 * Opening the pouring order early doesn't release it.
 */
export function isTastingReleased(
	tastingDate: string,
	now: Date,
	manual?: ManualPhaseChanges
): boolean {
	if (getTastingPhase(tastingDate, now, manual) === 'revealed') return true;
	const { date, hour } = getBerlinDateTime(now);
	return date > tastingDate || (date === tastingDate && hour >= TASTING_RELEASE_HOUR);
}

// Offset of Berlin local time from UTC at `instant` (ms since the epoch).
function berlinOffsetMs(instant: number): number {
	const p = berlinParts(new Date(instant));
	const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
	return wall - Math.floor(instant / 1000) * 1000;
}

// The instant at which the Berlin clock shows `hour`:00 on `date`. The first
// guess uses the offset at the wall time read as UTC, the second pass settles
// a clock change in between. (21:00 never falls into the skipped hour.)
function berlinWallTime(date: string, hour: number): Date {
	const [year, month, day] = date.split('-').map(Number);
	const wall = Date.UTC(year, month - 1, day, hour);
	const guess = wall - berlinOffsetMs(wall);
	return new Date(wall - berlinOffsetMs(guess));
}

/**
 * The next moment strictly after `now` at which the Berlin clock shows
 * `hour`:00 – when the daily distillery research runs. In UTC this moves by
 * an hour with daylight saving time.
 */
export function nextBerlinTime(now: Date, hour: number): Date {
	let date = getBerlinToday(now);
	let next = berlinWallTime(date, hour);
	while (next.getTime() <= now.getTime()) {
		date = nextDay(date);
		next = berlinWallTime(date, hour);
	}
	return next;
}
