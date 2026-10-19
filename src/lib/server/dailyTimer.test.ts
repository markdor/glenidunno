import { describe, it, expect, afterEach, vi } from 'vitest';
import { startDailyTimer } from './dailyTimer';

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

describe('startDailyTimer', () => {
	it('runs at the next 21:00 Berlin time and every evening after', () => {
		let clock = new Date('2026-06-20T10:00:00Z'); // 12:00 CEST
		const run = vi.fn();
		const { timers, schedule, cancel } = fakeScheduler();

		const stop = startDailyTimer({ hour: 21, run, now: () => clock, schedule, cancel });

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

	it('runs at any other hour, e.g. 18:00 for the pouring orders', () => {
		const { timers, schedule, cancel } = fakeScheduler();
		startDailyTimer({
			hour: 18,
			run: vi.fn(),
			now: () => new Date('2026-06-20T10:00:00Z'), // 12:00 CEST
			schedule,
			cancel
		});
		expect(timers[0].delayMs).toBe(6 * HOUR);
	});

	it('runs again at once if the timeout fired a moment early', () => {
		let clock = new Date('2026-06-20T15:59:59.999Z'); // 17:59:59.999 CEST
		const run = vi.fn();
		const { timers, schedule, cancel } = fakeScheduler();

		startDailyTimer({ hour: 18, run, now: () => clock, schedule, cancel });
		timers[0].callback();

		// Still before 18:00: the next run is due in a millisecond, not tomorrow.
		expect(timers[1].delayMs).toBe(1);
		clock = new Date('2026-06-20T16:00:00Z');
		timers[1].callback();
		expect(run).toHaveBeenCalledTimes(2);
		expect(timers[2].delayMs).toBe(24 * HOUR);
	});

	it('follows daylight saving time', () => {
		const run = vi.fn();
		const { timers, schedule, cancel } = fakeScheduler();

		// 21:00 CEST on 24.10.2026, the clocks go back that night.
		startDailyTimer({
			hour: 21,
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

		const stop = startDailyTimer({ hour: 21, run });
		vi.advanceTimersByTime(59_000);
		expect(run).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1_000);
		expect(run).toHaveBeenCalledTimes(1);

		stop();
		vi.advanceTimersByTime(24 * HOUR);
		expect(run).toHaveBeenCalledTimes(1);
	});
});
