import type { NoteRowValue, NotesQueryValue, NotesResponseValue } from '@simple-todos/shared';
import { sql, type SQL } from 'drizzle-orm';
import { type AppDb } from '../db/index.js';

export class NoteService {
  readonly #db: AppDb;

  constructor(db: AppDb) {
    this.#db = db;
  }

  /**
   * Every task carrying a note, newest note first, across active and archived
   * alike. Archived tasks hold the notes worth keeping — "this broke because
   * X" — so excluding them would gut the page.
   */
  list(query: NotesQueryValue): NotesResponseValue {
    const where: SQL[] = [sql`t.notes IS NOT NULL AND t.notes <> ''`];

    if (query.status === 'active') where.push(sql`t.archived_at IS NULL`);
    if (query.status === 'archived') where.push(sql`t.archived_at IS NOT NULL`);
    if (query.categoryId) where.push(sql`t.category_id = ${query.categoryId}`);
    if (query.q) where.push(sql`t.notes LIKE ${`%${query.q}%`} COLLATE NOCASE`);
    if (query.cursor) where.push(sql`t.notes_updated_at < ${decodeCursor(query.cursor)}`);

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
       ORDER BY t.notes_updated_at DESC
       LIMIT ${query.limit + 1}
    `);

    const page = rows.slice(0, query.limit);
    const nextCursor = rows.length > query.limit ? encodeCursor(page[page.length - 1]!.notesUpdatedAt) : null;

    return { notes: page, nextCursor };
  }
}

function encodeCursor(notesUpdatedAt: string): string {
  return Buffer.from(notesUpdatedAt, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf8');
}
