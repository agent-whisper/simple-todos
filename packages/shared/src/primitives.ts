import { z } from 'zod';

export const PRIORITIES = ['must', 'should', 'could'] as const;
export const Priority = z.enum(PRIORITIES);
export type PriorityValue = (typeof PRIORITIES)[number];

/** A calendar date with no time or zone: 'YYYY-MM-DD', read in settings.timezone. */
export const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  // The regex only checks the shape; a string like '2026-13-45' or '2026-02-31'
  // still passes it. Round-tripping through Date.UTC catches an impossible
  // calendar date: an out-of-range month or day rolls over (e.g. day 31 of a
  // 28-day February becomes March 3rd), so the parts read back from the
  // constructed date only match the input when the date was real.
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const asDate = new Date(Date.UTC(year, month - 1, day));
    return (
      asDate.getUTCFullYear() === year && asDate.getUTCMonth() === month - 1 && asDate.getUTCDate() === day
    );
  }, 'not a real calendar date');
export type LocalDateValue = string;

/** An instant, always stored and transmitted as ISO-8601 UTC. */
export const IsoDateTime = z.string().datetime();
export const Uuid = z.string().uuid();
