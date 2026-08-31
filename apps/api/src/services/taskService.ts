import type { CreateTaskRequestValue, TaskFilterValue, TaskNode, TaskValue } from '@simple-todos/shared';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../clock.js';
import { schema, type AppDb } from '../db/index.js';
import { ConflictError, NotFoundError } from '../domain/errors.js';
import { buildTree } from '../domain/tree.js';

export class TaskService {
  readonly #db: AppDb;
  readonly #clock: Clock;

  constructor(db: AppDb, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  create(input: CreateTaskRequestValue): TaskValue {
    const now = this.#clock.now().toISOString();
    const id = randomUUID();

    // Deterministic validation order when multiple things are wrong: parent existence,
    // then parent-archived (a tree archives atomically; an active child under an archived
    // parent would be a half-archived tree), then category existence.
    const parent = input.parentId ? this.get(input.parentId) : null;
    if (parent && parent.archivedAt !== null) {
      throw new ConflictError('cannot add a subtask to an archived task');
    }
    if (input.categoryId) this.#requireCategory(input.categoryId);
    const notes = input.notes ?? null;

    const row = {
      id,
      parentId: parent?.id ?? null,
      // A root is its own root; a subtask inherits, so a whole tree shares one value.
      rootId: parent ? parent.rootId : id,
      position: this.#nextPosition(parent?.id ?? null),
      title: input.title,
      notes,
      notesUpdatedAt: notes ? now : null,
      priority: input.priority ?? 'should',
      // An explicit category wins; otherwise a subtask starts in its parent's.
      categoryId: input.categoryId ?? parent?.categoryId ?? null,
      dueDate: input.dueDate ?? null,
      createdAt: now,
      completedAt: null,
      archivedAt: null,
      recurrenceId: null,
      occurrenceDate: null,
    };

    this.#db.insert(schema.tasks).values(row).run();
    return row as TaskValue;
  }

  get(id: string): TaskValue {
    const row = this.#db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!row) throw new NotFoundError('task', id);
    return row as TaskValue;
  }

  listActive(_filter: TaskFilterValue): TaskNode[] {
    const rows = this.#db
      .select()
      .from(schema.tasks)
      .where(isNull(schema.tasks.archivedAt))
      .orderBy(asc(schema.tasks.position))
      .all();
    return buildTree(rows as TaskValue[]);
  }

  /**
   * Only called for an explicitly supplied categoryId — a category inherited from the
   * parent is already known to exist, so the inherited path skips this query entirely.
   */
  #requireCategory(id: string): void {
    const row = this.#db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.id, id))
      .get();
    if (!row) throw new NotFoundError('category', id);
  }

  /**
   * Complete a task and everything beneath it (invariant 1).
   *
   * Deliberately does not archive: completed work stays visible until the
   * nightly sweep, which is what gives the list a sense of the day's progress.
   */
  complete(id: string): TaskValue {
    this.get(id); // 404 before mutating
    const now = this.#clock.now().toISOString();

    this.#db.transaction((tx) => {
      tx.run(sql`
        WITH RECURSIVE subtree(id) AS (
          SELECT ${id}
          UNION ALL
          SELECT t.id FROM task t JOIN subtree s ON t.parent_id = s.id
        )
        UPDATE task
           SET completed_at = ${now}
         WHERE id IN (SELECT id FROM subtree)
           AND completed_at IS NULL
      `);
    });

    return this.get(id);
  }

  /**
   * Reopen a task and every ancestor above it (invariant 1 in reverse).
   *
   * If the tree had been archived, the whole tree comes back to the active
   * list together (invariant 3) — this is the undo path for a box ticked by
   * mistake and noticed the next morning.
   */
  uncomplete(id: string): TaskValue {
    const task = this.get(id);

    this.#db.transaction((tx) => {
      if (task.archivedAt !== null) {
        tx.run(sql`UPDATE task SET archived_at = NULL WHERE root_id = ${task.rootId}`);
      }

      tx.run(sql`
        WITH RECURSIVE ancestry(id, parent_id) AS (
          SELECT id, parent_id FROM task WHERE id = ${id}
          UNION ALL
          SELECT t.id, t.parent_id FROM task t JOIN ancestry a ON t.id = a.parent_id
        )
        UPDATE task
           SET completed_at = NULL
         WHERE id IN (SELECT id FROM ancestry)
      `);
    });

    return this.get(id);
  }

  /** Append after the last sibling. Gaps are fine; only relative order matters. */
  #nextPosition(parentId: string | null): number {
    const row = this.#db
      .select({ max: sql<number | null>`max(${schema.tasks.position})` })
      .from(schema.tasks)
      .where(parentId === null ? isNull(schema.tasks.parentId) : eq(schema.tasks.parentId, parentId))
      .get();
    return (row?.max ?? -1) + 1;
  }
}
