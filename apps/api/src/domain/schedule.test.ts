import { describe, expect, it } from 'vitest';
import {
  isScheduledOn,
  parseDaysOfWeek,
  scheduledDatesBetween,
  serialiseDaysOfWeek,
  type Schedule,
} from './schedule.js';

const daily: Schedule = { scheduleKind: 'daily', daysOfWeek: null };
// 2026-08-31 is a Monday. ISO: Mon=1 .. Sun=7.
const mwf: Schedule = { scheduleKind: 'weekly', daysOfWeek: [1, 3, 5] };
const sundays: Schedule = { scheduleKind: 'weekly', daysOfWeek: [7] };

describe('isScheduledOn', () => {
  it('is true every day for a daily schedule', () => {
    for (const d of ['2026-08-31', '2026-09-01', '2026-09-06']) {
      expect(isScheduledOn(daily, d)).toBe(true);
    }
  });

  it('matches only the listed weekdays', () => {
    expect(isScheduledOn(mwf, '2026-08-31')).toBe(true); // Monday
    expect(isScheduledOn(mwf, '2026-09-01')).toBe(false); // Tuesday
    expect(isScheduledOn(mwf, '2026-09-02')).toBe(true); // Wednesday
    expect(isScheduledOn(mwf, '2026-09-04')).toBe(true); // Friday
    expect(isScheduledOn(mwf, '2026-09-05')).toBe(false); // Saturday
  });

  it('treats Sunday as 7, not 0', () => {
    expect(isScheduledOn(sundays, '2026-09-06')).toBe(true); // a Sunday
    expect(isScheduledOn(sundays, '2026-08-31')).toBe(false);
  });

  it('is false for a weekly schedule with an empty day list', () => {
    expect(isScheduledOn({ scheduleKind: 'weekly', daysOfWeek: [] }, '2026-08-31')).toBe(false);
  });
});

describe('scheduledDatesBetween', () => {
  it('excludes the lower bound and includes the upper', () => {
    expect(scheduledDatesBetween(daily, '2026-08-31', '2026-09-02')).toEqual([
      '2026-09-01',
      '2026-09-02',
    ]);
  });

  it('returns an empty array when the bounds touch', () => {
    expect(scheduledDatesBetween(daily, '2026-08-31', '2026-08-31')).toEqual([]);
  });

  it('returns an empty array when the upper bound precedes the lower', () => {
    expect(scheduledDatesBetween(daily, '2026-09-05', '2026-09-01')).toEqual([]);
  });

  it('skips unscheduled weekdays across a weekend', () => {
    // Mon 31 Aug exclusive through Wed 9 Sep inclusive, Mon/Wed/Fri only.
    expect(scheduledDatesBetween(mwf, '2026-08-31', '2026-09-09')).toEqual([
      '2026-09-02',
      '2026-09-04',
      '2026-09-07',
      '2026-09-09',
    ]);
  });

  it('spans a month boundary', () => {
    expect(scheduledDatesBetween(daily, '2026-08-30', '2026-09-01')).toEqual([
      '2026-08-31',
      '2026-09-01',
    ]);
  });

  it('spans a leap day', () => {
    expect(scheduledDatesBetween(daily, '2028-02-27', '2028-03-01')).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
  });

  it('handles a long gap without running away', () => {
    // A year of downtime on a weekly schedule: 52 or 53 occurrences, not 365.
    const dates = scheduledDatesBetween(sundays, '2026-01-01', '2026-12-31');
    expect(dates.length).toBeGreaterThan(50);
    expect(dates.length).toBeLessThan(54);
    expect(dates.every((d) => isScheduledOn(sundays, d))).toBe(true);
  });
});

describe('daysOfWeek serialisation', () => {
  it('round-trips through JSON', () => {
    expect(parseDaysOfWeek(serialiseDaysOfWeek([1, 3, 5]))).toEqual([1, 3, 5]);
  });

  it('maps null both ways for a daily schedule', () => {
    expect(serialiseDaysOfWeek(null)).toBeNull();
    expect(parseDaysOfWeek(null)).toBeNull();
  });

  it('throws on stored text that is not a day array', () => {
    expect(() => parseDaysOfWeek('"nonsense"')).toThrow();
    expect(() => parseDaysOfWeek('[0]')).toThrow();
    expect(() => parseDaysOfWeek('[8]')).toThrow();
  });
});
