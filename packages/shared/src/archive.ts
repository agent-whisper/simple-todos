import { z } from 'zod';
import { LocalDate, Uuid } from './primitives.js';
import { Task, TaskNodeSchema, type TaskNode, type TaskValue } from './task.js';

export const ArchiveGroupBy = z.enum(['parent', 'added', 'completed']);
export type ArchiveGroupByValue = z.infer<typeof ArchiveGroupBy>;

export const ArchiveQuery = z.object({
  groupBy: ArchiveGroupBy.default('parent'),
  categoryId: Uuid.optional(),
  /** Inclusive local-date bounds on the completion date. */
  from: LocalDate.optional(),
  to: LocalDate.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ArchiveQueryValue = z.infer<typeof ArchiveQuery>;

/** groupBy=parent: whole archived trees, most recently finished first. */
export const ArchiveTreeGroup = z.object({
  rootId: Uuid,
  latestCompletedAt: z.string(),
  tree: TaskNodeSchema,
});
export type ArchiveTreeGroupValue = { rootId: string; latestCompletedAt: string; tree: TaskNode };

/** groupBy=added|completed: a flat list under a date heading. */
export const ArchiveDateGroup = z.object({
  date: LocalDate,
  tasks: z.array(Task),
});
export type ArchiveDateGroupValue = { date: string; tasks: TaskValue[] };

export const ArchiveResponse = z.discriminatedUnion('groupBy', [
  z.object({
    groupBy: z.literal('parent'),
    groups: z.array(ArchiveTreeGroup),
    nextCursor: z.string().nullable(),
  }),
  z.object({
    groupBy: z.literal('added'),
    groups: z.array(ArchiveDateGroup),
    nextCursor: z.string().nullable(),
  }),
  z.object({
    groupBy: z.literal('completed'),
    groups: z.array(ArchiveDateGroup),
    nextCursor: z.string().nullable(),
  }),
]);
export type ArchiveResponseValue = z.infer<typeof ArchiveResponse>;
