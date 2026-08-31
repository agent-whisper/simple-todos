import { describe, expect, it } from 'vitest';
import { FixedClock } from './clock.js';
import { addLocalDays, compareLocalDate, localDate, localWeekday, startOfLocalDayUtc } from './time.js';

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

describe('startOfLocalDayUtc', () => {
  it('converts local midnight in Tokyo to the right UTC instant', () => {
    // Tokyo is UTC+9 year round, so midnight local is 15:00 UTC the day before.
    expect(startOfLocalDayUtc('2026-09-01', JST)).toBe('2026-08-31T15:00:00.000Z');
  });

  it('is the identity in UTC', () => {
    expect(startOfLocalDayUtc('2026-09-01', UTC)).toBe('2026-09-01T00:00:00.000Z');
  });

  it('honours the offset in force on that date, not today', () => {
    // New York: UTC-5 in January, UTC-4 in July.
    expect(startOfLocalDayUtc('2026-01-15', 'America/New_York')).toBe('2026-01-15T05:00:00.000Z');
    expect(startOfLocalDayUtc('2026-07-15', 'America/New_York')).toBe('2026-07-15T04:00:00.000Z');
  });

  it('round-trips with localDate', () => {
    for (const date of ['2026-01-01', '2026-06-15', '2026-12-31']) {
      expect(localDate(new Date(startOfLocalDayUtc(date, JST)), JST)).toBe(date);
    }
  });

  it('round-trips across a DST transition, in either hemisphere', () => {
    // Northern hemisphere: America/New_York springs forward 2026-03-08, falls back 2026-11-01.
    // Southern hemisphere: Australia/Sydney springs forward 2026-10-04, falls back 2026-04-05.
    // None of these dates skip local midnight, so the start of each day is well-defined and
    // round-tripping through localDate must land back on the same date.
    const cases: Array<[string, string]> = [
      ['2026-03-08', 'America/New_York'],
      ['2026-11-01', 'America/New_York'],
      ['2026-06-15', 'America/New_York'],
      ['2026-10-04', 'Australia/Sydney'],
      ['2026-04-05', 'Australia/Sydney'],
      ['2026-06-15', 'Australia/Sydney'],
    ];
    for (const [date, tz] of cases) {
      expect(localDate(new Date(startOfLocalDayUtc(date, tz)), tz)).toBe(date);
    }
  });

  it('round-trips in fractional-hour zones', () => {
    // Asia/Kolkata is UTC+5:30, Asia/Kathmandu is UTC+5:45 — neither offset is a whole hour.
    expect(localDate(new Date(startOfLocalDayUtc('2026-06-15', 'Asia/Kolkata')), 'Asia/Kolkata')).toBe(
      '2026-06-15',
    );
    expect(localDate(new Date(startOfLocalDayUtc('2026-06-15', 'Asia/Kathmandu')), 'Asia/Kathmandu')).toBe(
      '2026-06-15',
    );
  });

  it('returns the first instant of the target date when local midnight is skipped', () => {
    // Chile's clocks spring forward at local midnight: 2026-09-05 23:59:59 is
    // immediately followed by 2026-09-06 01:00:00 — 2026-09-06T00:00:00 local never
    // exists. The documented convention is that "the day starts at" the first instant
    // that genuinely belongs to that calendar date, i.e. the moment the clocks jump to.
    // Offset is UTC-4 before the jump and UTC-3 after, so that moment is 04:00:00Z.
    expect(startOfLocalDayUtc('2026-09-06', 'America/Santiago')).toBe('2026-09-06T04:00:00.000Z');
    expect(
      localDate(new Date(startOfLocalDayUtc('2026-09-06', 'America/Santiago')), 'America/Santiago'),
    ).toBe('2026-09-06');
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
