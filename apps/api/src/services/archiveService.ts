import type {
  ArchiveDateGroupValue,
  ArchiveQueryValue,
  ArchiveResponseValue,
  ArchiveTreeGroupValue,
  TaskValue,
} from '@simple-todos/shared';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../db/cursor.js';
import { type AppDb } from '../db/index.js';
import { buildTree } from '../domain/tree.js';
import { addLocalDays, localDate, startOfLocalDayUtc } from '../time.js';

const ByDateCursor = z.object({ completedAt: z.string(), id: z.string() });
const ByParentCursor = z.object({ latestCompletedAt: z.string(), rootId: z.string() });

const TASK_COLUMNS = sql`
  t.id, t.parent_id AS parentId, t.root_id AS rootId, t.position,
  t.title, t.notes, t.notes_updated_at AS notesUpdatedAt, t.priority,
  t.category_id AS categoryId, t.due_date AS dueDate,
  t.created_at AS createdAt, t.completed_at AS completedAt,
  t.archived_at AS archivedAt, t.recurrence_id AS recurrenceId,
  t.occurrence_date AS occurrenceDate
`;

export class ArchiveService {
  readonly #db: AppDb;

  constructor(db: AppDb) {
    this.#db = db;
  }

  list(query: ArchiveQueryValue, timezone: string): ArchiveResponseValue {
    return query.groupBy === 'parent'
      ? { groupBy: 'parent', ...this.#byParent(query, timezone) }
      : { groupBy: query.groupBy, ...this.#byDate(query, timezone) };
  }

  /** Whole trees, ordered by the most recent completion inside each. */
  #byParent(
    query: ArchiveQueryValue,
    timezone: string,
  ): { groups: ArchiveTreeGroupValue[]; nextCursor: string | null } {
    const having: SQL[] = [];
    if (query.categoryId) having.push(sql`sum(t.category_id = ${query.categoryId}) > 0`);
    for (const bound of this.#rangeBounds(query, timezone, sql`max(t.completed_at)`)) having.push(bound);
    if (query.cursor) {
      const { latestCompletedAt, rootId } = decodeCursor(query.cursor, ByParentCursor);
      having.push(sql`(max(t.completed_at), t.root_id) < (${latestCompletedAt}, ${rootId})`);
    }

    // Groups tie on `latestCompletedAt` whenever the cascade completes a whole tree in
    // one statement (every descendant gets the SAME completed_at) or two unrelated trees
    // finish at the same instant. `root_id` breaks the tie so every group stays addressable
    // across a page boundary instead of one silently vanishing.
    const roots = this.#db.all<{ rootId: string; latestCompletedAt: string }>(sql`
      SELECT t.root_id AS rootId, max(t.completed_at) AS latestCompletedAt
        FROM task t
       WHERE t.archived_at IS NOT NULL
       GROUP BY t.root_id
       ${having.length ? sql`HAVING ${sql.join(having, sql` AND `)}` : sql``}
       ORDER BY latestCompletedAt DESC, t.root_id DESC
       LIMIT ${query.limit + 1}
    `);

    const page = roots.slice(0, query.limit);
    const lastRoot = page[page.length - 1];
    const nextCursor =
      roots.length > query.limit && lastRoot
        ? encodeCursor({ latestCompletedAt: lastRoot.latestCompletedAt, rootId: lastRoot.rootId })
        : null;
    if (page.length === 0) return { groups: [], nextCursor: null };

    const ids = page.map((r) => r.rootId);
    const rows = this.#db.all<TaskValue>(sql`
      SELECT ${TASK_COLUMNS} FROM task t
       WHERE t.archived_at IS NOT NULL
         AND t.root_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
       ORDER BY t.position
    `);

    const byRoot = new Map<string, TaskValue[]>();
    for (const row of rows) {
      const bucket = byRoot.get(row.rootId) ?? [];
      bucket.push(row);
      byRoot.set(row.rootId, bucket);
    }

    const groups = page.flatMap<ArchiveTreeGroupValue>((root) => {
      const tree = buildTree(byRoot.get(root.rootId) ?? [])[0];
      return tree ? [{ rootId: root.rootId, latestCompletedAt: root.latestCompletedAt, tree }] : [];
    });

    return { groups, nextCursor };
  }

  /**
   * A flat list, always ordered by completion time descending, bucketed under
   * either its creation date or its completion date. Because the rows arrive
   * newest-completion-first, first-encounter order gives each group the
   * ordering the spec asks for without a second sort.
   */
  #byDate(
    query: ArchiveQueryValue,
    timezone: string,
  ): { groups: ArchiveDateGroupValue[]; nextCursor: string | null } {
    const where: SQL[] = [sql`t.archived_at IS NOT NULL`];
    if (query.categoryId) where.push(sql`t.category_id = ${query.categoryId}`);
    for (const bound of this.#rangeBounds(query, timezone, sql`t.completed_at`)) where.push(bound);
    if (query.cursor) {
      const { completedAt, id } = decodeCursor(query.cursor, ByDateCursor);
      where.push(sql`(t.completed_at, t.id) < (${completedAt}, ${id})`);
    }

    // `t.id` breaks ties on `completed_at`: a cascade completion stamps every descendant
    // in a tree with the same instant, so tied rows are the common case here, not the
    // exception — a bare-timestamp cursor would drop siblings across a page boundary.
    const rows = this.#db.all<TaskValue>(sql`
      SELECT ${TASK_COLUMNS} FROM task t
       WHERE ${sql.join(where, sql` AND `)}
       ORDER BY t.completed_at DESC, t.id DESC
       LIMIT ${query.limit + 1}
    `);

    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > query.limit && last
        ? encodeCursor({ completedAt: last.completedAt!, id: last.id })
        : null;

    const groups: ArchiveDateGroupValue[] = [];
    const index = new Map<string, ArchiveDateGroupValue>();
    for (const row of page) {
      const source = query.groupBy === 'added' ? row.createdAt : row.completedAt!;
      const date = localDate(new Date(source), timezone);
      let group = index.get(date);
      if (!group) {
        group = { date, tasks: [] };
        index.set(date, group);
        groups.push(group);
      }
      group.tasks.push(row);
    }

    return { groups, nextCursor };
  }

  /**
   * Local-date bounds, converted once into the UTC instants actually stored.
   *
   * `completedAtExpr` lets the two callers share this logic while comparing
   * against the shape their own query actually produces: `#byParent` groups
   * by root and needs the aggregate `max(t.completed_at)`, while `#byDate` is
   * flat and compares the bare column.
   */
  #rangeBounds(query: ArchiveQueryValue, timezone: string, completedAtExpr: SQL): SQL[] {
    const bounds: SQL[] = [];
    if (query.from) {
      bounds.push(sql`${completedAtExpr} >= ${startOfLocalDayUtc(query.from, timezone)}`);
    }
    if (query.to) {
      // Exclusive upper bound at the start of the following LOCAL day makes `to` inclusive.
      // Computed via addLocalDays (pure calendar-string arithmetic) rather than adding a flat
      // 24 raw UTC hours: when a DST transition falls between `to` and the next date, 24 hours
      // lands at the wrong instant — see the DST range tests in archiveService.test.ts.
      const exclusiveEnd = startOfLocalDayUtc(addLocalDays(query.to, 1), timezone);
      bounds.push(sql`${completedAtExpr} < ${exclusiveEnd}`);
    }
    return bounds;
  }
}
