import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';
import { TaskService } from './taskService.js';

let ctx: TestApp;
let tasks: TaskService;

beforeEach(async () => {
  ctx = await makeTestApp('2026-09-02T01:00:00Z');
  tasks = new TaskService(ctx.db, ctx.clock);
});

afterEach(async () => {
  await ctx.close();
});

describe('archive', () => {
  it('files away a finished task', () => {
    const task = tasks.create({ title: 'Fix the sink' });
    tasks.complete(task.id);

    const archived = tasks.archive(task.id);

    expect(archived.archivedAt).toBe('2026-09-02T01:00:00.000Z');
  });

  it('completes an unfinished task on the way, upholding invariant 2', () => {
    // Nothing may carry archived_at without completed_at, so archiving
    // something unfinished has to finish it rather than refuse.
    const task = tasks.create({ title: 'Good enough' });

    const archived = tasks.archive(task.id);

    expect(archived.completedAt).not.toBeNull();
    expect(archived.archivedAt).not.toBeNull();
  });

  it('archives the whole tree atomically, upholding invariant 3', () => {
    const root = tasks.create({ title: 'Plan trip' });
    const mid = tasks.create({ title: 'Travel', parentId: root.id });
    const leaf = tasks.create({ title: 'Book flights', parentId: mid.id });

    tasks.archive(root.id);

    const stamps = new Set(
      [root.id, mid.id, leaf.id].map((id) => tasks.get(id).archivedAt),
    );
    expect(stamps.size).toBe(1);
    expect([...stamps][0]).not.toBeNull();
  });

  it('archives the whole tree even when asked from a subtask', () => {
    // A tree cannot be half-archived, so this is a whole-tree operation
    // wherever it is invoked from.
    const root = tasks.create({ title: 'Plan trip' });
    const child = tasks.create({ title: 'Book flights', parentId: root.id });

    tasks.archive(child.id);

    expect(tasks.get(root.id).archivedAt).not.toBeNull();
    expect(tasks.get(child.id).archivedAt).toBe(tasks.get(root.id).archivedAt);
  });

  it('leaves an already-completed task its original completion time', () => {
    const root = tasks.create({ title: 'Plan trip' });
    const child = tasks.create({ title: 'Book flights', parentId: root.id });
    ctx.clock.set('2026-09-01T05:00:00Z');
    tasks.complete(child.id);

    ctx.clock.set('2026-09-02T01:00:00Z');
    tasks.archive(root.id);

    expect(tasks.get(child.id).completedAt).toBe('2026-09-01T05:00:00.000Z');
    expect(tasks.get(root.id).completedAt).toBe('2026-09-02T01:00:00.000Z');
  });

  it('never leaves an archived task uncompleted', () => {
    const root = tasks.create({ title: 'Plan trip' });
    tasks.create({ title: 'Book flights', parentId: root.id });

    tasks.archive(root.id);

    const bad = ctx.db.$client
      .prepare(`SELECT count(*) AS n FROM task WHERE archived_at IS NOT NULL AND completed_at IS NULL`)
      .get() as { n: number };
    expect(bad.n).toBe(0);
  });

  it('records the hit when the task is a repeat instance', () => {
    ctx.db.$client
      .prepare(
        `INSERT INTO recurrence (id, title, notes, priority, category_id, schedule_kind, days_of_week,
           active, last_processed_date, created_at, updated_at)
         VALUES ('rec-1', 'Exercise', NULL, 'should', NULL, 'daily', NULL, 1, '2026-09-01',
           '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
      )
      .run();
    ctx.db.$client
      .prepare(
        `INSERT INTO task (id, parent_id, root_id, position, title, notes, notes_updated_at, priority,
           category_id, due_date, created_at, completed_at, archived_at, recurrence_id, occurrence_date)
         VALUES ('inst-1', NULL, 'inst-1', 0, 'Exercise', NULL, NULL, 'should', NULL, '2026-09-02',
           '2026-09-02T00:00:00.000Z', NULL, NULL, 'rec-1', '2026-09-02')`,
      )
      .run();

    tasks.archive('inst-1');

    const log = ctx.db.$client
      .prepare(`SELECT occurrence_date, status FROM recurrence_log`)
      .all() as { occurrence_date: string; status: string }[];
    // Archiving a habit's instance is finishing it; the streak must reflect that.
    expect(log).toEqual([{ occurrence_date: '2026-09-02', status: 'completed' }]);
  });

  it('refuses to archive something already archived', () => {
    const task = tasks.create({ title: 'Fix the sink' });
    tasks.archive(task.id);

    expect(() => tasks.archive(task.id)).toThrow(/already archived/i);
  });

  it('throws NotFound for an unknown id', () => {
    expect(() => tasks.archive('11111111-1111-4111-8111-111111111111')).toThrow(/not found/i);
  });

  it('takes the tree out of the active list', () => {
    const root = tasks.create({ title: 'Plan trip' });
    tasks.create({ title: 'Book flights', parentId: root.id });

    tasks.archive(root.id);

    expect(tasks.listActive({})).toEqual([]);
  });
});
