import type { NoteRowValue, NotesQueryValue, NotesResponseValue } from '@simple-todos/shared';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../db/cursor.js';
import { type AppDb } from '../db/index.js';

const NoteCursor = z.object({ notesUpdatedAt: z.string(), taskId: z.string() });

export class NoteService {
  readonly #db: AppDb;

  constructor(db: AppDb) {
    this.#db = db;
  }

  /**
   * Every task carrying a note, newest note first, across active and archived
   * alike. Archived tasks hold the notes worth keeping — "this broke because
   * X" — so excluding them would gut the page.
   *
   * Ordered by `(notes_updated_at, id)` and paged with the same composite
   * tuple: ties on `notes_updated_at` (two notes touched in the same
   * millisecond) are common enough that a bare-timestamp cursor would
   * silently drop whichever row landed on the far side of a page boundary.
   */
  list(query: NotesQueryValue): NotesResponseValue {
    // notesUpdatedAt is non-nullable in the response contract (NoteRow), but
    // nothing in the schema enforces that a note-bearing row also has the
    // stamp set. TaskService always sets both together today, but another
    // write path could set notes without it, which would otherwise produce a
    // row that fails NotesResponse.safeParse downstream.
    const where: SQL[] = [sql`t.notes IS NOT NULL AND t.notes <> '' AND t.notes_updated_at IS NOT NULL`];

    if (query.status === 'active') where.push(sql`t.archived_at IS NULL`);
    if (query.status === 'archived') where.push(sql`t.archived_at IS NOT NULL`);
    if (query.categoryId) where.push(sql`t.category_id = ${query.categoryId}`);
    if (query.q) where.push(sql`t.notes LIKE ${`%${query.q}%`} COLLATE NOCASE`);
    if (query.cursor) {
      const { notesUpdatedAt, taskId } = decodeCursor(query.cursor, NoteCursor);
      where.push(sql`(t.notes_updated_at, t.id) < (${notesUpdatedAt}, ${taskId})`);
    }

    const rows = this.#db.all<NoteRowValue>(sql`
      SELECT t.id AS taskId, t.title, t.notes,
             t.notes_updated_at AS notesUpdatedAt, t.priority,
             t.category_id AS categoryId,
             CASE
               WHEN t.archived_at IS NOT NULL THEN 'archived'
               WHEN t.completed_at IS NOT NULL THEN 'done'
               ELSE 'active'
             END AS status,
             t.created_at AS createdAt, t.completed_at AS completedAt
        FROM task t
       WHERE ${sql.join(where, sql` AND `)}
       ORDER BY t.notes_updated_at DESC, t.id DESC
       LIMIT ${query.limit + 1}
    `);

    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > query.limit && last
        ? encodeCursor({ notesUpdatedAt: last.notesUpdatedAt, taskId: last.taskId })
        : null;

    return { notes: page, nextCursor };
  }
}
