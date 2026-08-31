import type { CreateTaskRequestValue, TaskFilterValue, TaskNode, TaskValue } from '@simple-todos/shared';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../clock.js';
import { schema, type AppDb } from '../db/index.js';
import { NotFoundError } from '../domain/errors.js';
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

    const parent = input.parentId ? this.get(input.parentId) : null;
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
