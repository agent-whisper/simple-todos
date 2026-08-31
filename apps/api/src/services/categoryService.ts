import type { CategoryValue, CreateCategoryRequestValue, UpdateCategoryRequestValue } from '@simple-todos/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../clock.js';
import { schema, type AppDb } from '../db/index.js';
import { ConflictError, NotFoundError } from '../domain/errors.js';

export class CategoryService {
  readonly #db: AppDb;
  readonly #clock: Clock;

  constructor(db: AppDb, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  list(): CategoryValue[] {
    return this.#db
      .select()
      .from(schema.categories)
      .orderBy(asc(schema.categories.position))
      .all() as CategoryValue[];
  }

  create(input: CreateCategoryRequestValue): CategoryValue {
    this.#assertNameFree(input.name, null);

    const row = {
      id: randomUUID(),
      name: input.name,
      color: input.color,
      position: this.#nextPosition(),
      createdAt: this.#clock.now().toISOString(),
    };

    this.#db.insert(schema.categories).values(row).run();
    return row;
  }

  update(id: string, patch: UpdateCategoryRequestValue): CategoryValue {
    this.#get(id);
    if (patch.name !== undefined) this.#assertNameFree(patch.name, id);

    if (Object.keys(patch).length > 0) {
      this.#db.update(schema.categories).set(patch).where(eq(schema.categories.id, id)).run();
    }
    return this.#get(id);
  }

  /** The foreign key nulls category_id on tasks; nothing is deleted with it. */
  remove(id: string): void {
    this.#get(id);
    this.#db.delete(schema.categories).where(eq(schema.categories.id, id)).run();
  }

  #get(id: string): CategoryValue {
    const row = this.#db.select().from(schema.categories).where(eq(schema.categories.id, id)).get();
    if (!row) throw new NotFoundError('category', id);
    return row as CategoryValue;
  }

  /**
   * The unique index on lower(name) would raise a bare SQLite error; check
   * first so the client gets a 409 with a message it can show.
   */
  #assertNameFree(name: string, exceptId: string | null): void {
    const clash = this.#db.get<{ id: string }>(sql`
      SELECT id FROM category
       WHERE lower(name) = lower(${name})
         AND (${exceptId} IS NULL OR id <> ${exceptId})
       LIMIT 1
    `);
    if (clash) throw new ConflictError(`a category named "${name}" already exists`);
  }

  #nextPosition(): number {
    const row = this.#db
      .select({ max: sql<number | null>`max(${schema.categories.position})` })
      .from(schema.categories)
      .get();
    return (row?.max ?? -1) + 1;
  }
}
