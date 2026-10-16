import { describe, it, expect, afterEach, vi } from 'vitest';
import { startDistilleryResearchTimer } from './distilleryResearchTimer';

const HOUR = 60 * 60 * 1000;

afterEach(() => {
	vi.useRealTimers();
});

function fakeScheduler() {
	const timers: Array<{ callback: () => void; delayMs: number; unref: ReturnType<typeof vi.fn> }> =
		[];
	const schedule = vi.fn((callback: () => void, delayMs: number) => {
		const timer = { callback, delayMs, unref: vi.fn() };
		timers.push(timer);
		return timer;
	});
	return { timers, schedule, cancel: vi.fn() };
}

describe('startDistilleryResearchTimer', () => {
	it('runs at the next 21:00 Berlin time and every evening after', () => {
		let clock = new Date('2026-06-20T10:00:00Z'); // 12:00 CEST
		const run = vi.fn();
		const { timers, schedule, cancel } = fakeScheduler();

		const stop = startDistilleryResearchTimer({ run, now: () => clock, schedule, cancel });

		expect(timers).toHaveLength(1);
		expect(timers[0].delayMs).toBe(9 * HOUR);
		// It never keeps the process alive.
		expect(timers[0].unref).toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();

		clock = new Date('2026-06-20T19:00:00Z');
		timers[0].callback();
		expect(run).toHaveBeenCalledTimes(1);
		expect(timers[1].delayMs).toBe(24 * HOUR);

		stop();
		expect(cancel).toHaveBeenCalledWith(timers[1]);
	});

	it('follows daylight saving time', () => {
		const run = vi.fn();
		const { timers, schedule, cancel } = fakeScheduler();

		// 21:00 CEST on 24.10.2026, the clocks go back that night.
		startDistilleryResearchTimer({
			run,
			now: () => new Date('2026-10-24T19:00:00Z'),
			schedule,
			cancel
		});

		expect(timers[0].delayMs).toBe(25 * HOUR);
	});

	it('uses the real clock and timers by default', () => {
		vi.useFakeTimers({ now: new Date('2026-12-12T19:59:00Z') }); // 20:59 CET
		const run = vi.fn();

		const stop = startDistilleryResearchTimer({ run });
		vi.advanceTimersByTime(59_000);
		expect(run).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1_000);
		expect(run).toHaveBeenCalledTimes(1);

		stop();
		vi.advanceTimersByTime(24 * HOUR);
		expect(run).toHaveBeenCalledTimes(1);
	});
});
