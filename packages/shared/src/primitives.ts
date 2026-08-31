import { z } from 'zod';

export const PRIORITIES = ['must', 'should', 'could'] as const;
export const Priority = z.enum(PRIORITIES);
export type PriorityValue = (typeof PRIORITIES)[number];

/** A calendar date with no time or zone: 'YYYY-MM-DD', read in settings.timezone. */
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export type LocalDateValue = string;

/** An instant, always stored and transmitted as ISO-8601 UTC. */
export const IsoDateTime = z.string().datetime();
export const Uuid = z.string().uuid();
