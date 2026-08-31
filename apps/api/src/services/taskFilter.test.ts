import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';
import { CategoryService } from './categoryService.js';
import { TaskService } from './taskService.js';

let ctx: TestApp;
let tasks: TaskService;
let categories: CategoryService;

beforeEach(async () => {
  ctx = await makeTestApp('2026-08-31T01:00:00Z');
  tasks = new TaskService(ctx.db, ctx.clock);
  categories = new CategoryService(ctx.db, ctx.clock);
});

afterEach(async () => {
  await ctx.close();
});

/** Flatten a tree to its titles, depth first. */
function titles(nodes: ReturnType<TaskService['listActive']>): string[] {
  return nodes.flatMap((n) => [n.title, ...titles(n.children)]);
}

describe('listActive filtering', () => {
  it('filters by category', () => {
    const chores = categories.create({ name: 'Chores', color: '#4488ff' });
    tasks.create({ title: 'Laundry', categoryId: chores.id });
    tasks.create({ title: 'Write spec' });

    expect(titles(tasks.listActive({ categoryId: chores.id }))).toEqual(['Laundry']);
  });

  it('filters by priority', () => {
    tasks.create({ title: 'Ship release', priority: 'must' });
    tasks.create({ title: 'Tidy desk', priority: 'could' });

    expect(titles(tasks.listActive({ priority: 'must' }))).toEqual(['Ship release']);
  });

  it('searches titles case-insensitively', () => {
    tasks.create({ title: 'Buy Oat Milk' });
    tasks.create({ title: 'Write spec' });

    expect(titles(tasks.listActive({ q: 'oat' }))).toEqual(['Buy Oat Milk']);
  });

  it('searches notes as well as titles', () => {
    tasks.create({ title: 'Fix sink', notes: 'the washer is worn' });
    tasks.create({ title: 'Write spec' });

    expect(titles(tasks.listActive({ q: 'washer' }))).toEqual(['Fix sink']);
  });

  it('keeps a matching subtask in context by returning its ancestors', () => {
    const root = tasks.create({ title: 'Plan trip' });
    const mid = tasks.create({ title: 'Travel', parentId: root.id });
    tasks.create({ title: 'Book flights', parentId: mid.id });
    tasks.create({ title: 'Unrelated' });

    const tree = tasks.listActive({ q: 'flights' });

    expect(titles(tree)).toEqual(['Plan trip', 'Travel', 'Book flights']);
    expect(tree).toHaveLength(1);
  });

  it('does not pull in non-matching siblings of a match', () => {
    const root = tasks.create({ title: 'Plan trip' });
    tasks.create({ title: 'Book flights', parentId: root.id });
    tasks.create({ title: 'Pack bags', parentId: root.id });

    expect(titles(tasks.listActive({ q: 'flights' }))).toEqual(['Plan trip', 'Book flights']);
  });

  it('combines filters conjunctively', () => {
    const chores = categories.create({ name: 'Chores', color: '#4488ff' });
    tasks.create({ title: 'Laundry', categoryId: chores.id, priority: 'must' });
    tasks.create({ title: 'Dishes', categoryId: chores.id, priority: 'could' });

    expect(titles(tasks.listActive({ categoryId: chores.id, priority: 'must' }))).toEqual(['Laundry']);
  });

  it('never returns archived tasks, whatever the filter', () => {
    const task = tasks.create({ title: 'Old thing' });
    ctx.db.$client
      .prepare(`UPDATE task SET completed_at = ?, archived_at = ? WHERE id = ?`)
      .run('2026-08-30T10:00:00.000Z', '2026-08-31T18:00:00.000Z', task.id);

    expect(tasks.listActive({ q: 'old' })).toEqual([]);
  });

  it('returns everything when no filter is given', () => {
    tasks.create({ title: 'One' });
    tasks.create({ title: 'Two' });
    expect(titles(tasks.listActive({}))).toHaveLength(2);
  });

  it('returns an empty array when nothing matches', () => {
    tasks.create({ title: 'One' });
    expect(tasks.listActive({ q: 'nothing here' })).toEqual([]);
  });

  it(
    'does not hang when listActive encounters a pre-existing cycle in parent_id',
    { timeout: 5000 },
    () => {
      // move() itself always refuses to create a cycle, so we bypass it here and
      // write a cycle directly with raw SQL to simulate data corruption (e.g. from
      // a bug, a manual DB edit, or a future code path that forgets the guard).
      // Before the depth bound was added to the `visible` CTE's recursive term,
      // this made `listActive` hang forever while walking the ancestor chain of a
      // match, since SQLite's recursive CTEs never detect cycles on their own —
      // `UNION`'s deduplication only helps once a repeated row is actually
      // produced, which a match sitting inside the cycle prevents from happening.
      const a = tasks.create({ title: 'A' });
      const b = tasks.create({ title: 'B', parentId: a.id });
      const c = tasks.create({ title: 'Book flights', parentId: b.id });

      // a -> b -> c -> a, a genuine cycle that `move` would never allow.
      ctx.db.$client.prepare('UPDATE task SET parent_id = ? WHERE id = ?').run(c.id, a.id);

      expect(() => tasks.listActive({ q: 'flights' })).not.toThrow();
    },
  );
});
