import { nextBerlinTime } from './tastingPhase';

export type DailyTimerOptions = {
	/** Berlin hour the run is due at, e.g. TASTING_RELEASE_HOUR. */
	hour: number;
	run: () => void;
	now?: () => Date;
	schedule?: (callback: () => void, delayMs: number) => { unref(): unknown };
	cancel?: (timer: { unref(): unknown }) => void;
};

/**
 * Runs `run` daily at `hour`:00 Berlin time: the distillery research at 21:00
 * and freezing the pouring orders at 18:00. A recursive timeout to the next
 * run instead of an interval, so it follows daylight saving time; unref'd, it
 * never keeps the process alive. Both runs take everything that is due, so a
 * missed one is made up the day after. Returns a function that stops the
 * timer.
 */
export function startDailyTimer({
	hour,
	run,
	now = () => new Date(),
	schedule = (callback, delayMs) => setTimeout(callback, delayMs),
	cancel = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)
}: DailyTimerOptions): () => void {
	let timer: { unref(): unknown };
	const arm = () => {
		const current = now();
		const delay = nextBerlinTime(current, hour).getTime() - current.getTime();
		timer = schedule(() => {
			run();
			arm();
		}, delay);
		timer.unref();
	};
	arm();
	return () => cancel(timer);
}
