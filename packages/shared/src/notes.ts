import { z } from 'zod';
import { IsoDateTime, Priority, Uuid } from './primitives.js';

export const NoteStatus = z.enum(['active', 'done', 'archived']);
export type NoteStatusValue = z.infer<typeof NoteStatus>;

export const NotesQuery = z.object({
  q: z.string().min(1).optional(),
  categoryId: Uuid.optional(),
  status: z.enum(['active', 'archived', 'all']).default('all'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type NotesQueryValue = z.infer<typeof NotesQuery>;

export const NoteRow = z.object({
  taskId: Uuid,
  title: z.string(),
  notes: z.string(),
  notesUpdatedAt: IsoDateTime,
  priority: Priority,
  categoryId: Uuid.nullable(),
  status: NoteStatus,
  createdAt: IsoDateTime,
  completedAt: IsoDateTime.nullable(),
});
export type NoteRowValue = z.infer<typeof NoteRow>;

export const NotesResponse = z.object({
  notes: z.array(NoteRow),
  nextCursor: z.string().nullable(),
});
export type NotesResponseValue = z.infer<typeof NotesResponse>;
