import { ReminderPayload } from '@simple-todos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';
import { CategoryService } from './categoryService.js';
import { ReminderService } from './reminderService.js';
import { SettingsService } from './settingsService.js';
import { TaskService } from './taskService.js';

let ctx: TestApp;
let tasks: TaskService;
let categories: CategoryService;
let reminder: ReminderService;

beforeEach(async () => {
  // 2026-09-01T00:00Z is 09:00 on the 1st in Tokyo.
  ctx = await makeTestApp('2026-09-01T00:00:00Z');
  const settings = new SettingsService(ctx.db, ctx.clock);
  tasks = new TaskService(ctx.db, ctx.clock);
  categories = new CategoryService(ctx.db, ctx.clock);
  reminder = new ReminderService(ctx.db, settings);
});

afterEach(async () => {
  await ctx.close();
});

function makeHabitWithInstance() {
  ctx.db.$client
    .prepare(
      `INSERT INTO recurrence (id, title, notes, priority, category_id, schedule_kind, days_of_week,
         active, last_processed_date, created_at, updated_at)
       VALUES ('rec-1', 'Exercise', NULL, 'should', NULL, 'daily', NULL, 1, '2026-08-31',
         '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z')`,
    )
    .run();
  ctx.db.$client
    .prepare(
      `INSERT INTO task (id, parent_id, root_id, position, title, notes, notes_updated_at, priority,
         category_id, due_date, created_at, completed_at, archived_at, recurrence_id, occurrence_date)
       VALUES ('inst-1', NULL, 'inst-1', 0, 'Exercise', NULL, NULL, 'should', NULL, '2026-09-01',
         '2026-09-01T00:00:00.000Z', NULL, NULL, 'rec-1', '2026-09-01')`,
    )
    .run();
}

describe('buildPayload', () => {
  it('matches the shared contract', () => {
    expect(ReminderPayload.safeParse(reminder.buildPayload('2026-09-01')).success).toBe(true);
  });

  it('carries the date and the configured timezone', () => {
    expect(reminder.buildPayload('2026-09-01')).toMatchObject({
      date: '2026-09-01',
      timezone: 'Asia/Tokyo',
    });
  });

  it('lists an overdue task separately from one due today', () => {
    tasks.create({ title: 'File taxes', dueDate: '2026-08-20' });
    tasks.create({ title: 'Book flights', dueDate: '2026-09-01' });
    tasks.create({ title: 'Later thing', dueDate: '2026-09-10' });

    const p = reminder.buildPayload('2026-09-01');

    expect(p.overdue.map((t) => t.title)).toEqual(['File taxes']);
    expect(p.dueToday.map((t) => t.title)).toEqual(['Book flights']);
  });

  it('excludes completed tasks from overdue', () => {
    const done = tasks.create({ title: 'Already done', dueDate: '2026-08-20' });
    tasks.complete(done.id);

    expect(reminder.buildPayload('2026-09-01').overdue).toEqual([]);
  });

  it('carries the category name, not just the id', () => {
    const cat = categories.create({ name: 'Chores', color: '#4488ff' });
    tasks.create({ title: 'Laundry', dueDate: '2026-09-01', categoryId: cat.id });

    expect(reminder.buildPayload('2026-09-01').dueToday[0]!.categoryName).toBe('Chores');
  });

  it('leaves categoryName null for an uncategorised task', () => {
    tasks.create({ title: 'Loose end', dueDate: '2026-09-01' });
    expect(reminder.buildPayload('2026-09-01').dueToday[0]!.categoryName).toBeNull();
  });

  it('lists today repeat instances separately from ordinary due-today tasks', () => {
    makeHabitWithInstance();
    tasks.create({ title: 'Book flights', dueDate: '2026-09-01' });

    const p = reminder.buildPayload('2026-09-01');

    expect(p.repeatsToday.map((t) => t.title)).toEqual(['Exercise']);
    expect(p.dueToday.map((t) => t.title)).toEqual(['Book flights']);
  });

  it('reports what was completed yesterday, in the local timezone', () => {
    const late = tasks.create({ title: 'Just after midnight' });
    // 2026-08-31T15:30Z is 00:30 on the 1st in Tokyo — NOT yesterday.
    ctx.clock.set('2026-08-31T15:30:00Z');
    tasks.complete(late.id);

    const yesterday = tasks.create({ title: 'Renew passport' });
    // 2026-08-31T05:00Z is 14:00 on the 31st in Tokyo — yesterday.
    ctx.clock.set('2026-08-31T05:00:00Z');
    tasks.complete(yesterday.id);

    expect(reminder.buildPayload('2026-09-01').completedYesterday.map((t) => t.title)).toEqual([
      'Renew passport',
    ]);
  });

  it('includes an archived task in completed-yesterday', () => {
    const t = tasks.create({ title: 'Fix the sink' });
    ctx.clock.set('2026-08-31T05:00:00Z');
    tasks.complete(t.id);
    ctx.db.$client.prepare(`UPDATE task SET archived_at = '2026-09-01T18:00:00.000Z'`).run();

    expect(reminder.buildPayload('2026-09-01').completedYesterday.map((t) => t.title)).toEqual([
      'Fix the sink',
    ]);
  });

  it('names habits missed yesterday', () => {
    makeHabitWithInstance();
    ctx.db.$client
      .prepare(
        `INSERT INTO recurrence_log (id, recurrence_id, occurrence_date, status, completed_at)
         VALUES ('log-1', 'rec-1', '2026-08-31', 'missed', NULL)`,
      )
      .run();

    expect(reminder.buildPayload('2026-09-01').missedYesterday).toEqual(['Exercise']);
  });

  it('does not name a habit that was completed yesterday', () => {
    makeHabitWithInstance();
    ctx.db.$client
      .prepare(
        `INSERT INTO recurrence_log (id, recurrence_id, occurrence_date, status, completed_at)
         VALUES ('log-1', 'rec-1', '2026-08-31', 'completed', '2026-08-31T05:00:00.000Z')`,
      )
      .run();

    expect(reminder.buildPayload('2026-09-01').missedYesterday).toEqual([]);
  });

  it('returns empty sections rather than throwing when there is nothing', () => {
    expect(reminder.buildPayload('2026-09-01')).toMatchObject({
      overdue: [],
      dueToday: [],
      repeatsToday: [],
      completedYesterday: [],
      missedYesterday: [],
    });
  });
});
