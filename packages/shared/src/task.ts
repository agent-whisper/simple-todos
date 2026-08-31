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
  })
  .partial();
export type UpdateTaskRequestValue = z.infer<typeof UpdateTaskRequest>;

export const MoveTaskRequest = z.object({
  parentId: Uuid.nullable(),
  position: z.number().int().min(0),
});
export type MoveTaskRequestValue = z.infer<typeof MoveTaskRequest>;

export const TaskFilter = z.object({
  categoryId: Uuid.optional(),
  priority: Priority.optional(),
  q: z.string().min(1).optional(),
});
export type TaskFilterValue = z.infer<typeof TaskFilter>;
