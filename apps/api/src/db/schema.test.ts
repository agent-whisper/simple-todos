import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, runMigrations, type AppDb } from './index.js';
import { makeTempDbFile, removeTempDb } from '../../test/helpers/tempDb.js';

let db: AppDb;
let file: string;

beforeEach(() => {
  file = makeTempDbFile();
  db = openDb(file);
  runMigrations(db);
});

afterEach(() => {
  db.$client.close();
  removeTempDb(file);
});

describe('migrations', () => {
  it('creates every table the application needs', () => {
    const rows = db.$client
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const t of ['category', 'job_run', 'recurrence', 'recurrence_log', 'settings', 'task', 'user']) {
      expect(names).toContain(t);
    }
  });

  it('is idempotent when run twice', () => {
    expect(() => runMigrations(db)).not.toThrow();
  });
});

describe('table constraints', () => {
  function insertTask(fields: Record<string, unknown>) {
    const base = {
      id: 'task-1',
      parent_id: null,
      root_id: 'task-1',
      position: 0,
      title: 'a task',
      notes: null,
      notes_updated_at: null,
      priority: 'should',
      category_id: null,
      due_date: null,
      created_at: '2026-08-31T00:00:00.000Z',
      completed_at: null,
      archived_at: null,
      recurrence_id: null,
      occurrence_date: null,
      ...fields,
    };
    const cols = Object.keys(base).join(', ');
    const placeholders = Object.keys(base).map(() => '?').join(', ');
    db.$client.prepare(`INSERT INTO task (${cols}) VALUES (${placeholders})`).run(...Object.values(base));
  }

  it('rejects an archived task that is not completed (invariant 2)', () => {
    expect(() => insertTask({ archived_at: '2026-09-01T18:00:00.000Z' })).toThrow(/CHECK/i);
  });

  it('accepts an archived task that is completed', () => {
    expect(() =>
      insertTask({
        completed_at: '2026-08-31T10:00:00.000Z',
        archived_at: '2026-09-01T18:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('rejects an unknown priority', () => {
    expect(() => insertTask({ priority: 'urgent' })).toThrow(/CHECK/i);
  });

  it('requires occurrence_date when recurrence_id is set', () => {
    db.$client
      .prepare(
        `INSERT INTO recurrence (id, title, notes, priority, category_id, schedule_kind, days_of_week, active, last_processed_date, created_at, updated_at)
         VALUES ('rec-1', 'Exercise', NULL, 'should', NULL, 'daily', NULL, 1, '2026-08-31', '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z')`,
      )
      .run();
    expect(() => insertTask({ recurrence_id: 'rec-1', occurrence_date: null })).toThrow(/CHECK/i);
    expect(() => insertTask({ recurrence_id: 'rec-1', occurrence_date: '2026-08-31' })).not.toThrow();
  });

  it('allows an orphaned occurrence_date after its recurrence is deleted', () => {
    db.$client
      .prepare(
        `INSERT INTO recurrence (id, title, notes, priority, category_id, schedule_kind, days_of_week, active, last_processed_date, created_at, updated_at)
         VALUES ('rec-1', 'Exercise', NULL, 'should', NULL, 'daily', NULL, 1, '2026-08-31', '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z')`,
      )
      .run();
    insertTask({ recurrence_id: 'rec-1', occurrence_date: '2026-08-31' });

    db.$client.prepare(`DELETE FROM recurrence WHERE id = 'rec-1'`).run();

    const row = db.$client.prepare(`SELECT recurrence_id, occurrence_date FROM task WHERE id = 'task-1'`).get() as {
      recurrence_id: string | null;
      occurrence_date: string | null;
    };
    expect(row.recurrence_id).toBeNull();
    expect(row.occurrence_date).toBe('2026-08-31');
  });

  it('deletes a subtree when its parent is deleted', () => {
    insertTask({ id: 'parent', root_id: 'parent' });
    insertTask({ id: 'child', parent_id: 'parent', root_id: 'parent' });
    db.$client.prepare(`DELETE FROM task WHERE id = 'parent'`).run();
    const remaining = db.$client.prepare(`SELECT count(*) AS n FROM task`).get() as { n: number };
    expect(remaining.n).toBe(0);
  });

  it('nulls category_id on tasks when a category is deleted, keeping the task', () => {
    db.$client
      .prepare(`INSERT INTO category (id, name, color, position, created_at) VALUES ('cat-1', 'Chores', '#4488ff', 0, '2026-08-31T00:00:00.000Z')`)
      .run();
    insertTask({ category_id: 'cat-1' });
    db.$client.prepare(`DELETE FROM category WHERE id = 'cat-1'`).run();
    const row = db.$client.prepare(`SELECT category_id FROM task WHERE id = 'task-1'`).get() as { category_id: string | null };
    expect(row.category_id).toBeNull();
  });

  it('rejects two categories whose names differ only by case', () => {
    const insert = (id: string, name: string) =>
      db.$client
        .prepare(`INSERT INTO category (id, name, color, position, created_at) VALUES (?, ?, '#4488ff', 0, '2026-08-31T00:00:00.000Z')`)
        .run(id, name);
    insert('cat-1', 'Chores');
    expect(() => insert('cat-2', 'chores')).toThrow(/UNIQUE/i);
  });

  it('rejects a second instance of the same recurrence on the same date', () => {
    db.$client
      .prepare(
        `INSERT INTO recurrence (id, title, notes, priority, category_id, schedule_kind, days_of_week, active, last_processed_date, created_at, updated_at)
         VALUES ('rec-1', 'Exercise', NULL, 'should', NULL, 'daily', NULL, 1, '2026-08-31', '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z')`,
      )
      .run();
    insertTask({ id: 'inst-1', root_id: 'inst-1', recurrence_id: 'rec-1', occurrence_date: '2026-08-31' });
    expect(() =>
      insertTask({ id: 'inst-2', root_id: 'inst-2', recurrence_id: 'rec-1', occurrence_date: '2026-08-31' }),
    ).toThrow(/UNIQUE/i);
  });

  it('enforces foreign keys, which SQLite leaves off by default', () => {
    const row = db.$client.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });
});
