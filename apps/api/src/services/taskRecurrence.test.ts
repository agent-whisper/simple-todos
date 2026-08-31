import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';
import { TaskService } from './taskService.js';

let ctx: TestApp;
let tasks: TaskService;

beforeEach(async () => {
  ctx = await makeTestApp('2026-08-31T01:00:00Z');
  tasks = new TaskService(ctx.db, ctx.clock);

  ctx.db.$client
    .prepare(
      `INSERT INTO recurrence (id, title, notes, priority, category_id, schedule_kind, days_of_week,
         active, last_processed_date, created_at, updated_at)
       VALUES ('rec-1', 'Exercise', NULL, 'should', NULL, 'daily', NULL, 1, '2026-08-30',
         '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z')`,
    )
    .run();
});

afterEach(async () => {
  await ctx.close();
});

/** Spawn an instance the way the sweep will, so these tests do not depend on it. */
function makeInstance(id: string, occurrenceDate: string): string {
  ctx.db.$client
    .prepare(
      `INSERT INTO task (id, parent_id, root_id, position, title, notes, notes_updated_at, priority,
         category_id, due_date, created_at, completed_at, archived_at, recurrence_id, occurrence_date)
       VALUES (?, NULL, ?, 0, 'Exercise', NULL, NULL, 'should', NULL, ?, '2026-08-31T00:00:00.000Z',
         NULL, NULL, 'rec-1', ?)`,
    )
    .run(id, id, occurrenceDate, occurrenceDate);
  return id;
}

function logRows() {
  return ctx.db.$client
    .prepare(`SELECT occurrence_date, status, completed_at FROM recurrence_log ORDER BY occurrence_date`)
    .all() as { occurrence_date: string; status: string; completed_at: string | null }[];
}

describe('completing a recurrence instance', () => {
  it('writes a completed row into the history', () => {
    tasks.complete(makeInstance('inst-1', '2026-08-31'));
    expect(logRows()).toEqual([
      { occurrence_date: '2026-08-31', status: 'completed', completed_at: '2026-08-31T01:00:00.000Z' },
    ]);
  });

  it('writes nothing for an ordinary task', () => {
    tasks.complete(tasks.create({ title: 'Buy milk' }).id);
    expect(logRows()).toEqual([]);
  });

  it('is idempotent — completing twice leaves one row, with the later timestamp', () => {
    const id = makeInstance('inst-1', '2026-08-31');
    tasks.complete(id);
    tasks.uncomplete(id);
    ctx.clock.set('2026-08-31T05:00:00Z');
    tasks.complete(id);

    expect(logRows()).toHaveLength(1);
    expect(logRows()[0]!.completed_at).toBe('2026-08-31T05:00:00.000Z');
  });

  it('overwrites a missed row if the day is completed late', () => {
    ctx.db.$client
      .prepare(
        `INSERT INTO recurrence_log (id, recurrence_id, occurrence_date, status, completed_at)
         VALUES ('log-1', 'rec-1', '2026-08-31', 'missed', NULL)`,
      )
      .run();

    tasks.complete(makeInstance('inst-1', '2026-08-31'));

    expect(logRows()).toEqual([
      { occurrence_date: '2026-08-31', status: 'completed', completed_at: '2026-08-31T01:00:00.000Z' },
    ]);
  });

  it('uncompleting removes the history row, so the sweep can log it missed', () => {
    const id = makeInstance('inst-1', '2026-08-31');
    tasks.complete(id);
    tasks.uncomplete(id);
    expect(logRows()).toEqual([]);
  });

  it('records the instance once when it has ad-hoc subtasks', () => {
    // An instance is an ordinary task and can carry subtasks; completing it
    // cascades down, and exactly one history row must result.
    const instance = makeInstance('inst-1', '2026-08-31');
    tasks.create({ title: 'Stretch first', parentId: instance });

    tasks.complete(instance);

    expect(logRows()).toHaveLength(1);
  });

  it('leaves history alone when an orphaned instance is completed', () => {
    // Deleting a habit nulls recurrence_id but leaves occurrence_date behind.
    const id = makeInstance('inst-1', '2026-08-31');
    ctx.db.$client.prepare(`UPDATE task SET recurrence_id = NULL WHERE id = ?`).run(id);

    tasks.complete(id);

    expect(logRows()).toEqual([]);
  });

  it('does not disturb another date history', () => {
    tasks.complete(makeInstance('inst-1', '2026-08-30'));
    tasks.complete(makeInstance('inst-2', '2026-08-31'));

    expect(logRows().map((r) => r.occurrence_date)).toEqual(['2026-08-30', '2026-08-31']);
  });
});
