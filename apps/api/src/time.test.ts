import { describe, expect, it } from 'vitest';
import { FixedClock } from './clock.js';
import { addLocalDays, compareLocalDate, localDate, localWeekday } from './time.js';

const JST = 'Asia/Tokyo';
const UTC = 'UTC';

describe('localDate', () => {
  it('reads an instant as a calendar date in the given zone', () => {
    // 2026-08-31T20:00Z is already 2026-09-01 in Tokyo (UTC+9).
    const at = new Date('2026-08-31T20:00:00Z');
    expect(localDate(at, UTC)).toBe('2026-08-31');
    expect(localDate(at, JST)).toBe('2026-09-01');
  });

  it('handles the moment just before local midnight', () => {
    // 14:59Z is 23:59 JST, still the 31st.
    expect(localDate(new Date('2026-08-31T14:59:00Z'), JST)).toBe('2026-08-31');
    expect(localDate(new Date('2026-08-31T15:00:00Z'), JST)).toBe('2026-09-01');
  });

  it('honours a zone with daylight saving', () => {
    // New York is UTC-4 in August.
    expect(localDate(new Date('2026-08-31T03:00:00Z'), 'America/New_York')).toBe('2026-08-30');
  });
});

describe('addLocalDays', () => {
  it('advances and rewinds across month and year ends', () => {
    expect(addLocalDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addLocalDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addLocalDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('is a no-op for zero', () => {
    expect(addLocalDays('2026-08-31', 0)).toBe('2026-08-31');
  });
});

describe('localWeekday', () => {
  it('numbers days ISO-style, Monday is 1 and Sunday is 7', () => {
    expect(localWeekday('2026-08-31')).toBe(1); // a Monday
    expect(localWeekday('2026-09-06')).toBe(7); // the following Sunday
  });
});

describe('compareLocalDate', () => {
  it('orders dates chronologically', () => {
    expect(compareLocalDate('2026-01-01', '2026-01-02')).toBeLessThan(0);
    expect(compareLocalDate('2026-01-02', '2026-01-01')).toBeGreaterThan(0);
    expect(compareLocalDate('2026-01-01', '2026-01-01')).toBe(0);
  });
});

describe('FixedClock', () => {
  it('returns the instant it was given until moved', () => {
    const clock = new FixedClock('2026-08-31T00:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-08-31T00:00:00.000Z');
    clock.set('2026-09-01T00:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
});
