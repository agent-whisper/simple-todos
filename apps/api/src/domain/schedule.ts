import { z } from 'zod';
import { addLocalDays, compareLocalDate, localWeekday } from '../time.js';

export interface Schedule {
  scheduleKind: 'daily' | 'weekly';
  /** ISO weekday numbers, Mon=1 .. Sun=7. Null exactly when the schedule is daily. */
  daysOfWeek: number[] | null;
}

const DaysOfWeek = z.array(z.number().int().min(1).max(7));

export function serialiseDaysOfWeek(days: number[] | null): string | null {
  return days === null ? null : JSON.stringify(days);
}

export function parseDaysOfWeek(json: string | null): number[] | null {
  if (json === null) return null;
  return DaysOfWeek.parse(JSON.parse(json));
}

export function isScheduledOn(schedule: Schedule, date: string): boolean {
  if (schedule.scheduleKind === 'daily') return true;
  return (schedule.daysOfWeek ?? []).includes(localWeekday(date));
}

/**
 * Every scheduled date in `(afterDate, throughDate]`.
 *
 * The lower bound is exclusive because callers pass `last_processed_date` — the
 * day already closed out — and the upper is inclusive because callers pass the
 * last day they intend to resolve. Walking day by day is fine: the only caller
 * is catch-up after downtime, and a year's gap is 365 iterations.
 */
export function scheduledDatesBetween(
  schedule: Schedule,
  afterDate: string,
  throughDate: string,
): string[] {
  const dates: string[] = [];
  let cursor = addLocalDays(afterDate, 1);
  while (compareLocalDate(cursor, throughDate) <= 0) {
    if (isScheduledOn(schedule, cursor)) dates.push(cursor);
    cursor = addLocalDays(cursor, 1);
  }
  return dates;
}
