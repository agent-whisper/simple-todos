import type { HistoryEntryValue } from '@simple-todos/shared';
import { compareLocalDate } from '../time.js';

/**
 * Streaks over *scheduled occurrences*, not calendar days.
 *
 * A Mon/Wed/Fri habit hit three sessions running is a streak of 3, even though
 * the dates are not contiguous — the log only ever holds dates the habit was
 * actually due, so consecutive entries are consecutive opportunities.
 */
export function computeStreaks(entries: HistoryEntryValue[]): { current: number; longest: number } {
  const ordered = [...entries].sort((a, b) => compareLocalDate(a.date, b.date));

  let longest = 0;
  let run = 0;
  for (const entry of ordered) {
    run = entry.status === 'completed' ? run + 1 : 0;
    if (run > longest) longest = run;
  }

  // The current streak is the trailing run, so it is whatever `run` holds after
  // the final entry — zero if the most recent occurrence was missed.
  return { current: run, longest };
}
