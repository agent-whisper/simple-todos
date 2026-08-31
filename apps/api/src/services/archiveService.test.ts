import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';
import { ArchiveService } from './archiveService.js';
import { CategoryService } from './categoryService.js';
import { TaskService } from './taskService.js';

const JST = 'Asia/Tokyo';

let ctx: TestApp;
let tasks: TaskService;
let categories: CategoryService;
let archive: ArchiveService;

beforeEach(async () => {
  ctx = await makeTestApp('2026-08-31T01:00:00Z');
  tasks = new TaskService(ctx.db, ctx.clock);
  categories = new CategoryService(ctx.db, ctx.clock);
  archive = new ArchiveService(ctx.db);
});

afterEach(async () => {
  await ctx.close();
});

/** Complete a task at a given instant and archive its tree, as the sweep will. */
function completeAndArchive(id: string, completedAt: string, archivedAt = '2026-09-10T18:00:00.000Z') {
  ctx.clock.set(completedAt);
  tasks.complete(id);
  const rootId = tasks.get(id).rootId;
  ctx.db.$client.prepare(`UPDATE task SET archived_at = ? WHERE root_id = ?`).run(archivedAt, rootId);
}

describe('groupBy=parent', () => {
  it('returns whole trees, nested', () => {
    const root = tasks.create({ title: 'Plan trip' });
    tasks.create({ title: 'Book flights', parentId: root.id });
    completeAndArchive(root.id, '2026-09-01T10:00:00Z');

    const result = archive.list({ groupBy: 'parent', limit: 50 }, JST);

    expect(result.groupBy).toBe('parent');
    expect(result.groups).toHaveLength(1);
    const group = result.groups[0] as { tree: { title: string; children: unknown[] } };
    expect(group.tree.title).toBe('Plan trip');
    expect(group.tree.children).toHaveLength(1);
  });

  it('orders trees by their most recent completion, newest first', () => {
    const older = tasks.create({ title: 'Older' });
    const newer = tasks.create({ title: 'Newer' });
    completeAndArchive(older.id, '2026-09-01T10:00:00Z');
    completeAndArchive(newer.id, '2026-09-03T10:00:00Z');

    const result = archive.list({ groupBy: 'parent', limit: 50 }, JST);
    const titles = result.groups.map((g) => (g as { tree: { title: string } }).tree.title);
    expect(titles).toEqual(['Newer', 'Older']);
  });

  it('excludes tasks that are still active', () => {
    tasks.create({ title: 'Still going' });
    expect(archive.list({ groupBy: 'parent', limit: 50 }, JST).groups).toEqual([]);
  });

  it('includes a tree when any task in it matches the category filter', () => {
    const chores = categories.create({ name: 'Chores', color: '#4488ff' });
    const root = tasks.create({ title: 'Plan trip' });
    tasks.create({ title: 'Laundry first', parentId: root.id, categoryId: chores.id });
    completeAndArchive(root.id, '2026-09-01T10:00:00Z');

    const result = archive.list({ groupBy: 'parent', categoryId: chores.id, limit: 50 }, JST);
    expect(result.groups).toHaveLength(1);
  });
});

describe('groupBy=completed', () => {
  it('groups flat rows under their local completion date, newest first', () => {
    const a = tasks.create({ title: 'Monday task' });
    const b = tasks.create({ title: 'Tuesday task' });
    completeAndArchive(a.id, '2026-09-01T02:00:00Z'); // 11:00 JST on the 1st
    completeAndArchive(b.id, '2026-09-02T02:00:00Z'); // 11:00 JST on the 2nd

    const result = archive.list({ groupBy: 'completed', limit: 50 }, JST);

    expect(result.groups.map((g) => (g as { date: string }).date)).toEqual(['2026-09-02', '2026-09-01']);
  });

  it('assigns a task to its local date, not its UTC date', () => {
    const task = tasks.create({ title: 'Late night' });
    // 2026-09-01T16:00Z is 01:00 JST on the 2nd.
    completeAndArchive(task.id, '2026-09-01T16:00:00Z');

    const result = archive.list({ groupBy: 'completed', limit: 50 }, JST);
    expect((result.groups[0] as { date: string }).date).toBe('2026-09-02');
  });

  it('flattens subtasks into the list rather than nesting them', () => {
    const root = tasks.create({ title: 'Plan trip' });
    tasks.create({ title: 'Book flights', parentId: root.id });
    completeAndArchive(root.id, '2026-09-01T02:00:00Z');

    const result = archive.list({ groupBy: 'completed', limit: 50 }, JST);
    const group = result.groups[0] as { tasks: { title: string }[] };
    expect(group.tasks.map((t) => t.title).sort()).toEqual(['Book flights', 'Plan trip']);
  });

  it('honours an inclusive local-date range', () => {
    const inRange = tasks.create({ title: 'In range' });
    const tooEarly = tasks.create({ title: 'Too early' });
    completeAndArchive(inRange.id, '2026-09-02T02:00:00Z');
    completeAndArchive(tooEarly.id, '2026-08-30T02:00:00Z');

    const result = archive.list({ groupBy: 'completed', from: '2026-09-01', to: '2026-09-03', limit: 50 }, JST);

    const titles = result.groups.flatMap((g) => (g as { tasks: { title: string }[] }).tasks.map((t) => t.title));
    expect(titles).toEqual(['In range']);
  });

  it('includes a task completed at local 23:30 on a fall-back `to` date (America/New_York)', () => {
    // 2026-11-01 is the day DST ends in New York (clocks fall back at 2am local).
    // 2026-11-02T04:30:00Z is local 2026-11-01 23:30 — squarely on the `to` date, and
    // must not be excluded by an upper bound that assumes a flat 24-hour day.
    const task = tasks.create({ title: 'Late on fall-back day' });
    completeAndArchive(task.id, '2026-11-02T04:30:00Z');

    const result = archive.list(
      { groupBy: 'completed', from: '2026-11-01', to: '2026-11-01', limit: 50 },
      'America/New_York',
    );

    const titles = result.groups.flatMap((g) => (g as { tasks: { title: string }[] }).tasks.map((t) => t.title));
    expect(titles).toEqual(['Late on fall-back day']);
  });

  it('excludes a task completed at local 00:30 the day after a spring-forward `to` date (America/New_York)', () => {
    // 2026-03-08 is the day DST begins in New York. The day after starts at local
    // 2026-03-09 00:00, which is 2026-03-09T04:00:00Z (already on daylight time, offset
    // -4). A task completed at 2026-03-09T04:30:00Z is local 2026-03-09 00:30 — the day
    // *after* `to`, and must not be pulled in by an upper bound that adds a flat 24 hours
    // from the start of `to` (which would land at 05:00Z, one hour too late).
    const task = tasks.create({ title: 'Just after spring-forward day' });
    completeAndArchive(task.id, '2026-03-09T04:30:00Z');

    const result = archive.list(
      { groupBy: 'completed', from: '2026-03-08', to: '2026-03-08', limit: 50 },
      'America/New_York',
    );

    expect(result.groups).toEqual([]);
  });
});

describe('groupBy=added', () => {
  it('groups by creation date while still ordering by completion', () => {
    ctx.clock.set('2026-08-20T02:00:00Z');
    const old = tasks.create({ title: 'Created earlier' });
    ctx.clock.set('2026-08-25T02:00:00Z');
    const recent = tasks.create({ title: 'Created later' });

    completeAndArchive(recent.id, '2026-09-01T02:00:00Z');
    completeAndArchive(old.id, '2026-09-05T02:00:00Z');

    const result = archive.list({ groupBy: 'added', limit: 50 }, JST);

    // Groups are creation dates, ordered by the most recent completion inside them.
    expect(result.groups.map((g) => (g as { date: string }).date)).toEqual(['2026-08-20', '2026-08-25']);
  });
});

describe('pagination', () => {
  it('caps a page at the limit and returns a cursor that fetches the rest', () => {
    for (let i = 0; i < 3; i += 1) {
      const task = tasks.create({ title: `Task ${i}` });
      completeAndArchive(task.id, `2026-09-0${i + 1}T02:00:00Z`);
    }

    const first = archive.list({ groupBy: 'completed', limit: 2 }, JST);
    const firstTitles = first.groups.flatMap((g) => (g as { tasks: { title: string }[] }).tasks.map((t) => t.title));
    expect(firstTitles).toEqual(['Task 2', 'Task 1']);
    expect(first.nextCursor).not.toBeNull();

    const second = archive.list({ groupBy: 'completed', limit: 2, cursor: first.nextCursor! }, JST);
    const secondTitles = second.groups.flatMap((g) => (g as { tasks: { title: string }[] }).tasks.map((t) => t.title));
    expect(secondTitles).toEqual(['Task 0']);
    expect(second.nextCursor).toBeNull();
  });

  it('does not drop a sibling row when a completed parent and its children tie on the same completed_at', () => {
    // TaskService.complete cascades down and stamps every descendant with the SAME
    // completed_at in one statement, so a completed tree is a block of tied rows.
    const root = tasks.create({ title: 'Parent' });
    tasks.create({ title: 'Child A', parentId: root.id });
    tasks.create({ title: 'Child B', parentId: root.id });
    completeAndArchive(root.id, '2026-09-01T02:00:00Z');

    const titles: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = archive.list({ groupBy: 'completed', limit: 2, cursor: cursor ?? undefined }, JST);
      titles.push(
        ...page.groups.flatMap((g) => (g as { tasks: { title: string }[] }).tasks.map((t) => t.title)),
      );
      cursor = page.nextCursor;
      if (!cursor) break;
    }

    expect(titles.sort()).toEqual(['Child A', 'Child B', 'Parent'].sort());
    expect(new Set(titles).size).toBe(3);
  });

  it('does not drop a tree when two trees tie on the same latest completion, grouped by parent', () => {
    const treeA = tasks.create({ title: 'Tree A' });
    const treeB = tasks.create({ title: 'Tree B' });
    completeAndArchive(treeA.id, '2026-09-01T02:00:00Z');
    completeAndArchive(treeB.id, '2026-09-01T02:00:00Z');

    const first = archive.list({ groupBy: 'parent', limit: 1 }, JST);
    expect(first.groups).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();

    const second = archive.list({ groupBy: 'parent', limit: 1, cursor: first.nextCursor! }, JST);
    expect(second.groups).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const titles = [first, second].map(
      (r) => (r.groups[0] as { tree: { title: string } }).tree.title,
    );
    expect(titles.sort()).toEqual(['Tree A', 'Tree B']);
  });

  it('rejects a malformed cursor with a 400 instead of silently mis-filtering', () => {
    expect(() => archive.list({ groupBy: 'completed', limit: 50, cursor: 'not-a-real-cursor!!' }, JST)).toThrow();
    expect(() => archive.list({ groupBy: 'parent', limit: 50, cursor: 'not-a-real-cursor!!' }, JST)).toThrow();
  });
});
