import type { HistoryEntryValue } from '@simple-todos/shared';
import { describe, expect, it } from 'vitest';
import { computeStreaks } from './streaks.js';

const done = (date: string): HistoryEntryValue => ({
  date,
  status: 'completed',
  completedAt: `${date}T09:00:00.000Z`,
});
const missed = (date: string): HistoryEntryValue => ({ date, status: 'missed', completedAt: null });

describe('computeStreaks', () => {
  it('returns zeroes for no history', () => {
    expect(computeStreaks([])).toEqual({ current: 0, longest: 0 });
  });

  it('counts an unbroken run', () => {
    expect(computeStreaks([done('2026-09-01'), done('2026-09-02'), done('2026-09-03')])).toEqual({
      current: 3,
      longest: 3,
    });
  });

  it('resets the current streak at the most recent miss', () => {
    expect(
      computeStreaks([done('2026-09-01'), done('2026-09-02'), missed('2026-09-03'), done('2026-09-04')]),
    ).toEqual({ current: 1, longest: 2 });
  });

  it('reports current as zero when the latest occurrence was missed', () => {
    expect(computeStreaks([done('2026-09-01'), done('2026-09-02'), missed('2026-09-03')])).toEqual({
      current: 0,
      longest: 2,
    });
  });

  it('keeps the longest run from earlier in the history', () => {
    expect(
      computeStreaks([
        done('2026-09-01'),
        done('2026-09-02'),
        done('2026-09-03'),
        missed('2026-09-04'),
        done('2026-09-05'),
      ]),
    ).toEqual({ current: 1, longest: 3 });
  });

  it('sorts by date rather than trusting input order', () => {
    expect(computeStreaks([done('2026-09-03'), missed('2026-09-01'), done('2026-09-02')])).toEqual({
      current: 2,
      longest: 2,
    });
  });

  it('counts consecutive scheduled occurrences, not calendar days', () => {
    // A Mon/Wed/Fri habit: three scheduled days hit in a row is a streak of 3,
    // even though the calendar dates are not contiguous.
    expect(computeStreaks([done('2026-09-02'), done('2026-09-04'), done('2026-09-07')])).toEqual({
      current: 3,
      longest: 3,
    });
  });

  it('does not mutate the array it is given', () => {
    const entries = [done('2026-09-03'), done('2026-09-01')];
    computeStreaks(entries);
    expect(entries.map((e) => e.date)).toEqual(['2026-09-03', '2026-09-01']);
  });
});
