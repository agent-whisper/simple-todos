import { z } from 'zod';
import { IsoDateTime, LocalDate, Priority, Uuid } from './primitives.js';

export const Task = z.object({
  id: Uuid,
  parentId: Uuid.nullable(),
  rootId: Uuid,
  position: z.number().int(),
  title: z.string().min(1),
  notes: z.string().nullable(),
  notesUpdatedAt: IsoDateTime.nullable(),
  priority: Priority,
  categoryId: Uuid.nullable(),
  dueDate: LocalDate.nullable(),
  createdAt: IsoDateTime,
  completedAt: IsoDateTime.nullable(),
  archivedAt: IsoDateTime.nullable(),
  recurrenceId: Uuid.nullable(),
  occurrenceDate: LocalDate.nullable(),
  /** When you started working on it, or null if you are not. */
  workingOnAt: IsoDateTime.nullable(),
});
export type TaskValue = z.infer<typeof Task>;

export type TaskNode = TaskValue & { children: TaskNode[] };

export const TaskNodeSchema: z.ZodType<TaskNode> = Task.extend({
  children: z.lazy(() => z.array(TaskNodeSchema)),
});

export const CreateTaskRequest = z.object({
  title: z.string().min(1).max(500),
  parentId: Uuid.nullish(),
  categoryId: Uuid.nullish(),
  priority: Priority.optional(),
  dueDate: LocalDate.nullish(),
  notes: z.string().nullish(),
});
export type CreateTaskRequestValue = z.infer<typeof CreateTaskRequest>;

export const UpdateTaskRequest = z
  .object({
    title: z.string().min(1).max(500),
    notes: z.string().nullable(),
    priority: Priority,
    dueDate: LocalDate.nullable(),
    categoryId: Uuid.nullable(),
    /**
     * Whether you are working on it. A boolean going in, a stamp coming back as
     * `workingOnAt` — you say yes or no, the server records when, the same
     * shape as completing something.
     */
    workingOn: z.boolean(),
  })
  .partial();
export type UpdateTaskRequestValue = z.infer<typeof UpdateTaskRequest>;

export const MoveTaskRequest = z.object({
  parentId: Uuid.nullable(),
  position: z.number().int().min(0),
  /**
   * Optional third axis. Omitted means "leave the category alone"; null clears
   * it. Dragging onto a category heading changes both at once.
   */
  categoryId: Uuid.nullable().optional(),
});
export type MoveTaskRequestValue = z.infer<typeof MoveTaskRequest>;

export const TaskFilter = z.object({
  categoryId: Uuid.optional(),
  priority: Priority.optional(),
  q: z.string().min(1).optional(),
  /** Query strings carry text, so "true"/"false" have to be read as a boolean. */
  workingOn: z.stringbool().optional(),
});
export type TaskFilterValue = z.infer<typeof TaskFilter>;
