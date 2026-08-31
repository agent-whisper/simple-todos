import { z } from 'zod';
import { IsoDateTime, LocalDate, Priority, Uuid } from './primitives.js';

export const SCHEDULE_KINDS = ['daily', 'weekly'] as const;
export const ScheduleKind = z.enum(SCHEDULE_KINDS);
export type ScheduleKindValue = (typeof SCHEDULE_KINDS)[number];

/** ISO weekday numbers, Monday=1 .. Sunday=7. */
export const DayOfWeek = z.number().int().min(1).max(7);

export const Recurrence = z.object({
  id: Uuid,
  title: z.string().min(1).max(500),
  notes: z.string().nullable(),
  priority: Priority,
  categoryId: Uuid.nullable(),
  scheduleKind: ScheduleKind,
  daysOfWeek: z.array(DayOfWeek).nullable(),
  active: z.boolean(),
  /**
   * The last local date whose outcome has been resolved — logged completed or
   * missed. The sweep closes out everything strictly after it.
   */
  lastProcessedDate: LocalDate,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RecurrenceValue = z.infer<typeof Recurrence>;

const scheduleShapeIsConsistent = (v: {
  scheduleKind: ScheduleKindValue;
  daysOfWeek?: number[] | null;
}) => (v.scheduleKind === 'weekly' ? Array.isArray(v.daysOfWeek) && v.daysOfWeek.length > 0 : true);

export const CreateRecurrenceRequest = z
  .object({
    title: z.string().min(1).max(500),
    notes: z.string().nullish(),
    priority: Priority.optional(),
    categoryId: Uuid.nullish(),
    scheduleKind: ScheduleKind,
    daysOfWeek: z.array(DayOfWeek).nullish(),
  })
  .refine(scheduleShapeIsConsistent, {
    message: 'a weekly schedule needs at least one day of the week',
    path: ['daysOfWeek'],
  });
export type CreateRecurrenceRequestValue = z.infer<typeof CreateRecurrenceRequest>;

/**
 * Deliberately carries no cross-field refine: a patch may change only
 * `daysOfWeek`, leaving `scheduleKind` implicit, so consistency is checked in
 * the service against the merged result rather than the patch alone.
 */
export const UpdateRecurrenceRequest = z.object({
  title: z.string().min(1).max(500).optional(),
  notes: z.string().nullable().optional(),
  priority: Priority.optional(),
  categoryId: Uuid.nullable().optional(),
  scheduleKind: ScheduleKind.optional(),
  daysOfWeek: z.array(DayOfWeek).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateRecurrenceRequestValue = z.infer<typeof UpdateRecurrenceRequest>;

export const OCCURRENCE_STATUSES = ['completed', 'missed'] as const;
export const OccurrenceStatus = z.enum(OCCURRENCE_STATUSES);
export type OccurrenceStatusValue = (typeof OCCURRENCE_STATUSES)[number];

export const HistoryEntry = z.object({
  date: LocalDate,
  status: OccurrenceStatus,
  completedAt: IsoDateTime.nullable(),
});
export type HistoryEntryValue = z.infer<typeof HistoryEntry>;

export const HistoryQuery = z.object({
  from: LocalDate.optional(),
  to: LocalDate.optional(),
});
export type HistoryQueryValue = z.infer<typeof HistoryQuery>;

export const RecurrenceHistory = z.object({
  recurrenceId: Uuid,
  entries: z.array(HistoryEntry),
  currentStreak: z.number().int().min(0),
  longestStreak: z.number().int().min(0),
});
export type RecurrenceHistoryValue = z.infer<typeof RecurrenceHistory>;
