import { TASTING_RELEASE_HOUR } from '$lib/tasting';
import { nextBerlinTime } from './tastingPhase';

export type DistilleryResearchTimerOptions = {
	run: () => void;
	now?: () => Date;
	schedule?: (callback: () => void, delayMs: number) => { unref(): unknown };
	cancel?: (timer: { unref(): unknown }) => void;
};

/**
 * The daily distillery research at TASTING_RELEASE_HOUR Berlin time. A
 * recursive timeout to the next 21:00 instead of an interval, so it follows
 * daylight saving time; unref'd, it never keeps the process alive. Every run
 * takes all open values, so a missed evening is made up the day after.
 * Returns a function that stops the timer.
 */
export function startDistilleryResearchTimer({
	run,
	now = () => new Date(),
	schedule = (callback, delayMs) => setTimeout(callback, delayMs),
	cancel = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)
}: DistilleryResearchTimerOptions): () => void {
	let timer: { unref(): unknown };
	const arm = () => {
		const current = now();
		const delay = nextBerlinTime(current, TASTING_RELEASE_HOUR).getTime() - current.getTime();
		timer = schedule(() => {
			run();
			arm();
		}, delay);
		timer.unref();
	};
	arm();
	return () => cancel(timer);
}
