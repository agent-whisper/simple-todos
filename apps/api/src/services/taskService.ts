import type {
  CreateTaskRequestValue,
  TaskFilterValue,
  TaskNode,
  TaskValue,
  UpdateTaskRequestValue,
} from '@simple-todos/shared';
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
      // `depth < 1000` bounds an otherwise-unbounded recursion: SQLite's
      // `UNION ALL` recursive CTEs do not detect cycles, so a corrupted
      // parent_id cycle (which move() itself always refuses to create, but a
      // bug or manual edit could) would otherwise make this query loop
      // forever while holding the write lock. No real task tree nests
      // anywhere near this deep, so the bound never affects legitimate data.
      tx.run(sql`
        WITH RECURSIVE subtree(id, depth) AS (
          SELECT ${id}, 0
          UNION ALL
          SELECT t.id, s.depth + 1 FROM task t JOIN subtree s ON t.parent_id = s.id WHERE s.depth < 1000
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

      // See the matching comment in complete(): the depth bound turns a
      // possible infinite loop over a corrupted parent_id cycle into a
      // bounded, survivable query instead of a permanent lock-holding hang.
      tx.run(sql`
        WITH RECURSIVE ancestry(id, parent_id, depth) AS (
          SELECT id, parent_id, 0 FROM task WHERE id = ${id}
          UNION ALL
          SELECT t.id, t.parent_id, a.depth + 1 FROM task t JOIN ancestry a ON t.id = a.parent_id WHERE a.depth < 1000
        )
        UPDATE task
           SET completed_at = NULL
         WHERE id IN (SELECT id FROM ancestry)
      `);
    });

    return this.get(id);
  }

  /**
   * Reparent and/or reorder a task.
   *
   * Rejects a move that would put a task inside its own subtree (invariant 4),
   * then rewrites root_id for every node beneath it so the denormalisation
   * stays true.
   */
  move(id: string, parentId: string | null, position: number): TaskValue {
    const task = this.get(id);
    const parent = parentId ? this.get(parentId) : null;

    // Same reasoning as create(): an active task under an archived parent
    // would be a half-archived tree, and archival is keyed on root_id, so
    // this is the same invariant, just approached by a different path in.
    if (parent && parent.archivedAt !== null) {
      throw new ConflictError('cannot move a task under an archived task');
    }

    if (parent && this.#isSelfOrDescendant(id, parent.id)) {
      throw new ConflictError('that move would create a cycle');
    }

    const newRootId = parent ? parent.rootId : id;

    this.#db.transaction((tx) => {
      // Open a gap at the target position among the new siblings.
      tx.run(sql`
        UPDATE task
           SET position = position + 1
         WHERE id <> ${id}
           AND position >= ${position}
           AND parent_id IS ${parentId === null ? sql`NULL` : sql`${parentId}`}
      `);

      tx.run(sql`
        UPDATE task
           SET parent_id = ${parentId}, position = ${position}, root_id = ${newRootId}
         WHERE id = ${id}
      `);

      // Depth-bounded for the same reason as the CTEs in complete()/uncomplete():
      // move() itself never creates a cycle, but this defends against a
      // corrupted tree turning this rewrite into an infinite loop.
      tx.run(sql`
        WITH RECURSIVE subtree(id, depth) AS (
          SELECT ${id}, 0
          UNION ALL
          SELECT t.id, s.depth + 1 FROM task t JOIN subtree s ON t.parent_id = s.id WHERE s.depth < 1000
        )
        UPDATE task SET root_id = ${newRootId} WHERE id IN (SELECT id FROM subtree)
      `);
    });

    return this.get(id);
  }

  /** True when `candidate` is `id` itself or sits anywhere beneath it. */
  #isSelfOrDescendant(id: string, candidate: string): boolean {
    if (id === candidate) return true;
    // Depth-bounded for the same reason as the other recursive CTEs in this
    // file: a corrupted parent_id cycle would otherwise walk the ancestry
    // chain forever instead of terminating.
    const row = this.#db.get<{ hit: number }>(sql`
      WITH RECURSIVE ancestry(id, parent_id, depth) AS (
        SELECT id, parent_id, 0 FROM task WHERE id = ${candidate}
        UNION ALL
        SELECT t.id, t.parent_id, a.depth + 1 FROM task t JOIN ancestry a ON t.id = a.parent_id WHERE a.depth < 1000
      )
      SELECT 1 AS hit FROM ancestry WHERE id = ${id} LIMIT 1
    `);
    return row !== undefined;
  }

  update(id: string, patch: UpdateTaskRequestValue): TaskValue {
    const task = this.get(id);
    const changes: Record<string, unknown> = {};

    if (patch.title !== undefined) changes.title = patch.title;
    if (patch.priority !== undefined) changes.priority = patch.priority;
    if (patch.dueDate !== undefined) changes.dueDate = patch.dueDate;
    if (patch.categoryId !== undefined) {
      // Same reasoning as create(): only an explicit, non-null categoryId needs
      // to exist. Clearing it to null is always allowed and skips the check.
      if (patch.categoryId !== null) this.#requireCategory(patch.categoryId);
      changes.categoryId = patch.categoryId;
    }

    if (patch.notes !== undefined) {
      // Empty and null mean the same thing: there is no note.
      const next = patch.notes === null || patch.notes === '' ? null : patch.notes;
      changes.notes = next;
      if (next !== task.notes) {
        // Only a real text change moves the stamp; the Notes page orders by it,
        // so renaming a task must not float its note to the top.
        changes.notesUpdatedAt = next === null ? null : this.#clock.now().toISOString();
      }
    }

    if (Object.keys(changes).length > 0) {
      this.#db.update(schema.tasks).set(changes).where(eq(schema.tasks.id, id)).run();
    }

    return this.get(id);
  }

  /** Deletes the subtree; the parent_id foreign key cascades for us. */
  remove(id: string): void {
    this.get(id);
    this.#db.delete(schema.tasks).where(eq(schema.tasks.id, id)).run();
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
