import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';
import { CategoryService } from './categoryService.js';
import { RecurrenceService } from './recurrenceService.js';
import { SettingsService } from './settingsService.js';

let ctx: TestApp;
let recurrences: RecurrenceService;
let categories: CategoryService;

beforeEach(async () => {
  // 2026-08-31T01:00Z is 10:00 on the 31st in Tokyo.
  ctx = await makeTestApp('2026-08-31T01:00:00Z');
  const settings = new SettingsService(ctx.db, ctx.clock);
  recurrences = new RecurrenceService(ctx.db, ctx.clock, settings);
  categories = new CategoryService(ctx.db, ctx.clock);
});

afterEach(async () => {
  await ctx.close();
});

describe('create', () => {
  it('stores a daily habit with defaults', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    expect(r).toMatchObject({
      title: 'Exercise',
      priority: 'should',
      scheduleKind: 'daily',
      daysOfWeek: null,
      active: true,
      notes: null,
      categoryId: null,
    });
  });

  it('initialises lastProcessedDate to YESTERDAY, not today', () => {
    // The watermark means "the last date whose outcome is resolved". Today is
    // not resolved — its instance is about to be spawned and still has to be
    // closed out tomorrow. Setting it to today would make the sweep skip the
    // creation day entirely, since it resolves dates strictly after the mark.
    expect(recurrences.create({ title: 'Exercise', scheduleKind: 'daily' }).lastProcessedDate).toBe(
      '2026-08-30',
    );
  });

  it('derives that date in the configured timezone, not UTC', () => {
    const settings = new SettingsService(ctx.db, ctx.clock);
    settings.update({ timezone: 'UTC' });
    // 01:00Z is still the 31st in UTC but 10:00 on the 31st in Tokyo; both give
    // the same day here, so shift the clock to a point where they differ.
    ctx.clock.set('2026-08-31T20:00:00Z'); // 05:00 on the 1st in Tokyo, still the 31st in UTC
    expect(recurrences.create({ title: 'A', scheduleKind: 'daily' }).lastProcessedDate).toBe('2026-08-30');

    settings.update({ timezone: 'Asia/Tokyo' });
    expect(recurrences.create({ title: 'B', scheduleKind: 'daily' }).lastProcessedDate).toBe('2026-08-31');
  });

  it('stores a weekly habit with its days', () => {
    const r = recurrences.create({ title: 'Gym', scheduleKind: 'weekly', daysOfWeek: [1, 3, 5] });
    expect(r.daysOfWeek).toEqual([1, 3, 5]);
  });

  it('rejects a weekly schedule with no days', () => {
    expect(() => recurrences.create({ title: 'Gym', scheduleKind: 'weekly', daysOfWeek: [] })).toThrow();
    expect(() => recurrences.create({ title: 'Gym', scheduleKind: 'weekly' })).toThrow();
  });

  it('rejects days supplied for a daily schedule', () => {
    expect(() =>
      recurrences.create({ title: 'Exercise', scheduleKind: 'daily', daysOfWeek: [1] }),
    ).toThrow(/daily/i);
  });

  it('rejects an unknown categoryId with a not-found error', () => {
    expect(() =>
      recurrences.create({
        title: 'Exercise',
        scheduleKind: 'daily',
        categoryId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toThrow(/not found/i);
  });

  it('keeps a category that exists', () => {
    const cat = categories.create({ name: 'Health', color: '#22aa66' });
    expect(
      recurrences.create({ title: 'Exercise', scheduleKind: 'daily', categoryId: cat.id }).categoryId,
    ).toBe(cat.id);
  });
});

describe('list', () => {
  it('returns newest first and exposes active as a boolean', () => {
    recurrences.create({ title: 'One', scheduleKind: 'daily' });
    ctx.clock.set('2026-08-31T02:00:00Z');
    recurrences.create({ title: 'Two', scheduleKind: 'daily' });

    const all = recurrences.list();
    expect(all.map((r) => r.title)).toEqual(['Two', 'One']);
    expect(typeof all[0]!.active).toBe('boolean');
  });

  it('listActive excludes paused habits', () => {
    const a = recurrences.create({ title: 'Active', scheduleKind: 'daily' });
    const b = recurrences.create({ title: 'Paused', scheduleKind: 'daily' });
    recurrences.update(b.id, { active: false });

    expect(recurrences.listActive().map((r) => r.id)).toEqual([a.id]);
    expect(recurrences.list()).toHaveLength(2);
  });
});

describe('update', () => {
  it('changes only the fields present', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily', priority: 'must' });
    const updated = recurrences.update(r.id, { title: 'Morning exercise' });
    expect(updated.title).toBe('Morning exercise');
    expect(updated.priority).toBe('must');
  });

  it('switches daily to weekly when days are supplied together', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    expect(recurrences.update(r.id, { scheduleKind: 'weekly', daysOfWeek: [2, 4] })).toMatchObject({
      scheduleKind: 'weekly',
      daysOfWeek: [2, 4],
    });
  });

  it('rejects switching to weekly without days', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    expect(() => recurrences.update(r.id, { scheduleKind: 'weekly' })).toThrow(/day/i);
  });

  it('rejects clearing the days of a weekly schedule', () => {
    const r = recurrences.create({ title: 'Gym', scheduleKind: 'weekly', daysOfWeek: [1] });
    expect(() => recurrences.update(r.id, { daysOfWeek: null })).toThrow(/day/i);
  });

  it('clears the days when switching back to daily', () => {
    const r = recurrences.create({ title: 'Gym', scheduleKind: 'weekly', daysOfWeek: [1] });
    expect(recurrences.update(r.id, { scheduleKind: 'daily' }).daysOfWeek).toBeNull();
  });

  it('pauses and resumes without losing lastProcessedDate', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    recurrences.update(r.id, { active: false });
    expect(recurrences.update(r.id, { active: true }).lastProcessedDate).toBe(r.lastProcessedDate);
  });

  it('throws NotFound for an unknown id', () => {
    expect(() => recurrences.update('11111111-1111-4111-8111-111111111111', { title: 'x' })).toThrow(
      /not found/i,
    );
  });
});

describe('remove', () => {
  it('deletes the definition', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    recurrences.remove(r.id);
    expect(() => recurrences.get(r.id)).toThrow(/not found/i);
  });

  it('leaves already-spawned instance tasks behind as ordinary tasks', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    ctx.db.$client
      .prepare(
        `INSERT INTO task (id, parent_id, root_id, position, title, notes, notes_updated_at, priority,
           category_id, due_date, created_at, completed_at, archived_at, recurrence_id, occurrence_date)
         VALUES ('inst-1', NULL, 'inst-1', 0, 'Exercise', NULL, NULL, 'should', NULL, '2026-08-31',
           '2026-08-31T01:00:00.000Z', '2026-08-31T09:00:00.000Z', NULL, ?, '2026-08-31')`,
      )
      .run(r.id);

    recurrences.remove(r.id);

    const row = ctx.db.$client
      .prepare(`SELECT title, recurrence_id, occurrence_date, completed_at FROM task WHERE id = 'inst-1'`)
      .get() as {
      title: string;
      recurrence_id: string | null;
      occurrence_date: string | null;
      completed_at: string | null;
    };
    // Evidence of work actually done must survive deleting the habit.
    expect(row.title).toBe('Exercise');
    expect(row.recurrence_id).toBeNull();
    expect(row.occurrence_date).toBe('2026-08-31');
    expect(row.completed_at).not.toBeNull();
  });

  it('deletes the habit history along with the definition', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    ctx.db.$client
      .prepare(
        `INSERT INTO recurrence_log (id, recurrence_id, occurrence_date, status, completed_at)
         VALUES ('log-1', ?, '2026-08-30', 'missed', NULL)`,
      )
      .run(r.id);

    recurrences.remove(r.id);

    const n = ctx.db.$client.prepare(`SELECT count(*) AS n FROM recurrence_log`).get() as { n: number };
    expect(n.n).toBe(0);
  });
});
