import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';
import { RecurrenceService } from './recurrenceService.js';
import { SettingsService } from './settingsService.js';
import { SweepService } from './sweepService.js';
import { TaskService } from './taskService.js';

let ctx: TestApp;
let tasks: TaskService;
let recurrences: RecurrenceService;
let sweep: SweepService;

beforeEach(async () => {
  // 2026-08-31T01:00Z is 10:00 on the 31st in Tokyo.
  ctx = await makeTestApp('2026-08-31T01:00:00Z');
  const settings = new SettingsService(ctx.db, ctx.clock);
  tasks = new TaskService(ctx.db, ctx.clock);
  recurrences = new RecurrenceService(ctx.db, ctx.clock, settings);
  sweep = new SweepService(ctx.db, ctx.clock, recurrences);
});

afterEach(async () => {
  await ctx.close();
});

/** listActive returns a nested tree; flatten it so subtasks are visible too. */
const activeTitles = () => {
  const out: string[] = [];
  const walk = (nodes: ReturnType<TaskService['listActive']>) => {
    for (const n of nodes) {
      out.push(n.title);
      walk(n.children);
    }
  };
  walk(tasks.listActive({}));
  return out.sort();
};

/** Flat list of every active task, roots and subtasks alike. */
const activeFlat = () => {
  const out: ReturnType<TaskService['listActive']> = [];
  const walk = (nodes: ReturnType<TaskService['listActive']>) => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(tasks.listActive({}));
  return out;
};

const logRows = () =>
  ctx.db.$client
    .prepare(`SELECT occurrence_date, status FROM recurrence_log ORDER BY occurrence_date`)
    .all() as { occurrence_date: string; status: string }[];

describe('archiving complete trees', () => {
  it('archives a whole tree once every task in it is done', () => {
    const root = tasks.create({ title: 'Plan trip' });
    const child = tasks.create({ title: 'Book flights', parentId: root.id });
    tasks.complete(root.id);

    const result = sweep.sweep('2026-09-01');

    expect(result.archived).toBe(2);
    expect(tasks.get(root.id).archivedAt).not.toBeNull();
    expect(tasks.get(child.id).archivedAt).toBe(tasks.get(root.id).archivedAt);
    expect(activeTitles()).toEqual([]);
  });

  it('leaves a tree alone when any task in it is still open', () => {
    const root = tasks.create({ title: 'Plan trip' });
    const child = tasks.create({ title: 'Book flights', parentId: root.id });
    tasks.complete(child.id);

    sweep.sweep('2026-09-01');

    expect(tasks.get(root.id).archivedAt).toBeNull();
    expect(tasks.get(child.id).archivedAt).toBeNull();
    expect(activeTitles()).toEqual(['Book flights', 'Plan trip']);
  });

  it('archives every node of a tree with one timestamp', () => {
    const root = tasks.create({ title: 'A' });
    tasks.create({ title: 'B', parentId: root.id });
    tasks.create({ title: 'C', parentId: root.id });
    tasks.complete(root.id);

    sweep.sweep('2026-09-01');

    const stamps = ctx.db.$client
      .prepare(`SELECT DISTINCT archived_at FROM task WHERE root_id = ?`)
      .all(root.id) as { archived_at: string }[];
    expect(stamps).toHaveLength(1);
  });

  it('never archives an incomplete task, upholding invariant 2', () => {
    tasks.create({ title: 'Still going' });
    sweep.sweep('2026-09-01');

    const bad = ctx.db.$client
      .prepare(`SELECT count(*) AS n FROM task WHERE archived_at IS NOT NULL AND completed_at IS NULL`)
      .get() as { n: number };
    expect(bad.n).toBe(0);
  });

  it('does not re-archive an already archived tree', () => {
    const root = tasks.create({ title: 'A' });
    tasks.complete(root.id);
    sweep.sweep('2026-09-01');
    const first = tasks.get(root.id).archivedAt;

    ctx.clock.set('2026-09-02T18:00:00Z');
    sweep.sweep('2026-09-02');

    expect(tasks.get(root.id).archivedAt).toBe(first);
  });
});

describe('closing out repeatable tasks', () => {
  it('logs a miss and clears the stale instance', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    sweep.sweep('2026-08-31'); // spawns today's
    expect(activeTitles()).toEqual(['Exercise']);

    ctx.clock.set('2026-09-01T18:00:00Z');
    const result = sweep.sweep('2026-09-01'); // closes out the 31st, spawns the 1st

    expect(result.missed).toBe(1);
    expect(logRows()).toEqual([{ occurrence_date: '2026-08-31', status: 'missed' }]);
    // Exactly one instance in the list: today's, not a backlog.
    expect(activeTitles()).toEqual(['Exercise']);
    const instances = ctx.db.$client
      .prepare(`SELECT occurrence_date FROM task WHERE recurrence_id = ?`)
      .all(r.id) as { occurrence_date: string }[];
    expect(instances).toEqual([{ occurrence_date: '2026-09-01' }]);
  });

  it('does not log a miss for a day that was completed', () => {
    recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    sweep.sweep('2026-08-31');
    const instance = activeFlat().find((t) => t.title === 'Exercise')!;
    tasks.complete(instance.id);

    ctx.clock.set('2026-09-01T18:00:00Z');
    const result = sweep.sweep('2026-09-01');

    expect(result.missed).toBe(0);
    expect(logRows()).toEqual([{ occurrence_date: '2026-08-31', status: 'completed' }]);
  });

  it('skips days the habit is not scheduled for', () => {
    // 2026-08-31 is a Monday; this habit runs Mondays only.
    recurrences.create({ title: 'Gym', scheduleKind: 'weekly', daysOfWeek: [1] });
    sweep.sweep('2026-08-31');

    ctx.clock.set('2026-09-02T18:00:00Z');
    const result = sweep.sweep('2026-09-02'); // closes out Tue 1 Sep

    // Monday the 31st is missed; Tuesday was never due.
    expect(logRows()).toEqual([{ occurrence_date: '2026-08-31', status: 'missed' }]);
    expect(result.spawned).toBe(0); // Wednesday is not a Monday
  });

  it('ignores paused habits entirely', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    recurrences.update(r.id, { active: false });

    const result = sweep.sweep('2026-09-01');

    expect(result.spawned).toBe(0);
    expect(logRows()).toEqual([]);
  });

  it('advances the watermark so a date is never closed out twice', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    sweep.sweep('2026-08-31');

    ctx.clock.set('2026-09-01T18:00:00Z');
    sweep.sweep('2026-09-01');

    expect(recurrences.get(r.id).lastProcessedDate).toBe('2026-08-31');
  });
});

describe('spawning today instances', () => {
  it('creates one instance carrying the definition fields', () => {
    const r = recurrences.create({
      title: 'Exercise',
      scheduleKind: 'daily',
      priority: 'must',
      notes: 'a description of the habit',
    });

    const result = sweep.sweep('2026-08-31');

    expect(result.spawned).toBe(1);
    const instance = activeFlat().find((t) => t.title === 'Exercise')!;
    expect(instance).toMatchObject({
      priority: 'must',
      dueDate: '2026-08-31',
      occurrenceDate: '2026-08-31',
      recurrenceId: r.id,
      parentId: null,
      completedAt: null,
    });
  });

  it('does NOT copy the definition notes onto the instance', () => {
    // Copying would deposit an identical note on the Notes page every day.
    recurrences.create({ title: 'Exercise', scheduleKind: 'daily', notes: 'a description of the habit' });
    sweep.sweep('2026-08-31');

    const instance = activeFlat().find((t) => t.title === 'Exercise')!;
    expect(instance.notes).toBeNull();
    expect(instance.notesUpdatedAt).toBeNull();
  });

  it('carries the category through', () => {
    ctx.db.$client
      .prepare(
        `INSERT INTO category (id, name, color, position, created_at)
         VALUES ('cat-1', 'Health', '#22aa66', 0, '2026-08-30T00:00:00.000Z')`,
      )
      .run();
    recurrences.create({ title: 'Exercise', scheduleKind: 'daily', categoryId: 'cat-1' });

    sweep.sweep('2026-08-31');

    expect(activeFlat().find((t) => t.title === 'Exercise')!.categoryId).toBe('cat-1');
  });

  it('does not spawn a second instance for a date that already has one', () => {
    recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    sweep.sweep('2026-08-31');
    // Force a re-run of the same target date by clearing the ledger.
    ctx.db.$client.prepare(`DELETE FROM job_run`).run();

    const result = sweep.sweep('2026-08-31');

    expect(result.spawned).toBe(0);
    expect(activeFlat().filter((t) => t.title === 'Exercise')).toHaveLength(1);
  });
});

describe('idempotency and the ledger', () => {
  it('records the run in job_run', () => {
    sweep.sweep('2026-09-01');

    const rows = ctx.db.$client
      .prepare(`SELECT job_name, run_date FROM job_run`)
      .all() as { job_name: string; run_date: string }[];
    expect(rows).toEqual([{ job_name: 'sweep', run_date: '2026-09-01' }]);
  });

  it('is a no-op when the same date is swept twice', () => {
    recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    sweep.sweep('2026-08-31');

    const second = sweep.sweep('2026-08-31');

    expect(second.ran).toBe(false);
    expect(second.spawned).toBe(0);
    expect(activeFlat().filter((t) => t.title === 'Exercise')).toHaveLength(1);
  });

  it('reports the most recently swept date', () => {
    expect(sweep.lastSweptDate()).toBeNull();
    sweep.sweep('2026-09-01');
    sweep.sweep('2026-09-03');
    expect(sweep.lastSweptDate()).toBe('2026-09-03');
  });
});

describe('spawnDueInstances', () => {
  it('is idempotent and safe to call outside a sweep', () => {
    recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });

    expect(sweep.spawnDueInstances('2026-08-31')).toBe(1);
    expect(sweep.spawnDueInstances('2026-08-31')).toBe(0);
    expect(activeFlat().filter((t) => t.title === 'Exercise')).toHaveLength(1);
  });

  it('spawns nothing on a day the habit is not scheduled', () => {
    recurrences.create({ title: 'Gym', scheduleKind: 'weekly', daysOfWeek: [1] });
    expect(sweep.spawnDueInstances('2026-09-01')).toBe(0); // a Tuesday
  });
});
