import { describe, expect, it } from 'vitest';
import { timeUntilSweep } from './SweepCountdown';

const JST = 'Asia/Tokyo';

describe('timeUntilSweep', () => {
  it('counts the hours and minutes to the next sweep', () => {
    // 2026-09-01T13:00Z is 22:00 JST; the 03:00 sweep is 5 hours away.
    expect(timeUntilSweep(new Date('2026-09-01T13:00:00Z'), '03:00', JST)).toEqual({ hours: 5, minutes: 0 });
  });

  it('rolls to tomorrow once today sweep time has passed', () => {
    // 04:00 JST, just after the sweep — the next one is 23 hours away.
    expect(timeUntilSweep(new Date('2026-09-01T19:00:00Z'), '03:00', JST)).toEqual({ hours: 23, minutes: 0 });
  });

  it('handles a partial hour', () => {
    // 01:23 JST → 1h37m to 03:00.
    expect(timeUntilSweep(new Date('2026-08-31T16:23:00Z'), '03:00', JST)).toEqual({ hours: 1, minutes: 37 });
  });

  it('honours a different configured sweep time', () => {
    // 22:00 JST with a 23:30 sweep is 1h30m.
    expect(timeUntilSweep(new Date('2026-09-01T13:00:00Z'), '23:30', JST)).toEqual({ hours: 1, minutes: 30 });
  });

  it('works in a zone other than the browser own', () => {
    expect(timeUntilSweep(new Date('2026-09-01T22:00:00Z'), '03:00', 'UTC')).toEqual({ hours: 5, minutes: 0 });
  });

  it('reports a full day rather than zero when it is exactly sweep time', () => {
    // Exactly 03:00 JST. The sweep for today has just run, so the next is 24h off.
    expect(timeUntilSweep(new Date('2026-08-31T18:00:00Z'), '03:00', JST)).toEqual({ hours: 24, minutes: 0 });
  });

  it('is unaffected by a half-hour offset zone', () => {
    // 22:00 in Kolkata (UTC+5:30) is 16:30Z.
    expect(timeUntilSweep(new Date('2026-09-01T16:30:00Z'), '03:00', 'Asia/Kolkata')).toEqual({
      hours: 5,
      minutes: 0,
    });
  });
});
