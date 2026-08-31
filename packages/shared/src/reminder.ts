import { z } from 'zod';
import { LocalDate, Priority, Uuid } from './primitives.js';

export const TaskLine = z.object({
  id: Uuid,
  title: z.string(),
  priority: Priority,
  categoryName: z.string().nullable(),
  dueDate: LocalDate.nullable(),
});
export type TaskLineValue = z.infer<typeof TaskLine>;

export const ReminderPayload = z.object({
  date: LocalDate,
  timezone: z.string(),
  overdue: z.array(TaskLine),
  dueToday: z.array(TaskLine),
  repeatsToday: z.array(TaskLine),
  completedYesterday: z.array(TaskLine),
  missedYesterday: z.array(z.string()),
});
export type ReminderPayloadValue = z.infer<typeof ReminderPayload>;
