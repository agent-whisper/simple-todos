import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';
import { TaskService } from './taskService.js';

let ctx: TestApp;
let tasks: TaskService;

beforeEach(async () => {
  ctx = await makeTestApp('2026-08-31T01:00:00Z');
  tasks = new TaskService(ctx.db, ctx.clock);
});

afterEach(async () => {
  await ctx.close();
});

describe('move', () => {
  it('reparents a task', () => {
    const a = tasks.create({ title: 'A' });
    const b = tasks.create({ title: 'B' });

    const moved = tasks.move(b.id, a.id, 0);

    expect(moved.parentId).toBe(a.id);
    expect(moved.rootId).toBe(a.id);
  });

  it('rewrites root_id across the whole moved subtree', () => {
    const a = tasks.create({ title: 'A' });
    const b = tasks.create({ title: 'B' });
    const bChild = tasks.create({ title: 'B child', parentId: b.id });
    const bGrandchild = tasks.create({ title: 'B grandchild', parentId: bChild.id });

    tasks.move(b.id, a.id, 0);

    expect(tasks.get(bChild.id).rootId).toBe(a.id);
    expect(tasks.get(bGrandchild.id).rootId).toBe(a.id);
  });

  it('promotes a subtask to a root, making it its own root_id', () => {
    const parent = tasks.create({ title: 'Parent' });
    const child = tasks.create({ title: 'Child', parentId: parent.id });
    const grandchild = tasks.create({ title: 'Grandchild', parentId: child.id });

    const moved = tasks.move(child.id, null, 0);

    expect(moved.parentId).toBeNull();
    expect(moved.rootId).toBe(child.id);
    expect(tasks.get(grandchild.id).rootId).toBe(child.id);
  });

  it('reorders siblings without changing the parent', () => {
    const parent = tasks.create({ title: 'Parent' });
    const first = tasks.create({ title: 'First', parentId: parent.id });
    const second = tasks.create({ title: 'Second', parentId: parent.id });

    tasks.move(second.id, parent.id, 0);

    const children = tasks.listActive({})[0]!.children;
    expect(children.map((c) => c.title)).toEqual(['Second', 'First']);
  });

  it('rejects moving a task under itself (invariant 4)', () => {
    const a = tasks.create({ title: 'A' });
    expect(() => tasks.move(a.id, a.id, 0)).toThrow(/cycle/i);
  });

  it('rejects moving a task under its own descendant (invariant 4)', () => {
    const a = tasks.create({ title: 'A' });
    const child = tasks.create({ title: 'Child', parentId: a.id });
    const grandchild = tasks.create({ title: 'Grandchild', parentId: child.id });

    expect(() => tasks.move(a.id, grandchild.id, 0)).toThrow(/cycle/i);
  });

  it('leaves the tree untouched when a move is rejected', () => {
    const a = tasks.create({ title: 'A' });
    const child = tasks.create({ title: 'Child', parentId: a.id });

    expect(() => tasks.move(a.id, child.id, 0)).toThrow();

    expect(tasks.get(a.id).parentId).toBeNull();
    expect(tasks.get(child.id).parentId).toBe(a.id);
  });

  it('throws NotFound for an unknown task or an unknown new parent', () => {
    const a = tasks.create({ title: 'A' });
    const missing = '11111111-1111-4111-8111-111111111111';
    expect(() => tasks.move(missing, null, 0)).toThrow(/not found/i);
    expect(() => tasks.move(a.id, missing, 0)).toThrow(/not found/i);
  });

  it('rejects moving a task under an archived parent', () => {
    const oldThing = tasks.create({ title: 'Old thing' });
    ctx.db.$client
      .prepare(`UPDATE task SET completed_at = ?, archived_at = ? WHERE id = ?`)
      .run('2026-08-30T10:00:00.000Z', '2026-08-31T18:00:00.000Z', oldThing.id);
    const orphan = tasks.create({ title: 'Orphan' });

    expect(() => tasks.move(orphan.id, oldThing.id, 0)).toThrow(/archived/i);

    // Rejected — leaves the tree exactly as it was.
    expect(tasks.get(orphan.id).parentId).toBeNull();
  });

  it('still allows moving a task under a parent that is completed but not archived', () => {
    const doneToday = tasks.create({ title: 'Done today' });
    ctx.db.$client.prepare(`UPDATE task SET completed_at = ? WHERE id = ?`).run('2026-08-31T09:00:00.000Z', doneToday.id);
    const lateAddition = tasks.create({ title: 'Late addition' });

    const moved = tasks.move(lateAddition.id, doneToday.id, 0);

    expect(moved.parentId).toBe(doneToday.id);
  });

  it(
    'does not hang when complete() encounters a pre-existing cycle in parent_id',
    { timeout: 5000 },
    () => {
      // move() itself always refuses to create a cycle, so we bypass it here and
      // write a cycle directly with raw SQL to simulate data corruption (e.g. from
      // a bug, a manual DB edit, or a future code path that forgets the guard).
      // Before the depth bound was added to the recursive CTEs, this made
      // `complete` hang forever holding the write lock, since SQLite's
      // `UNION ALL` recursive CTEs never detect cycles on their own.
      const a = tasks.create({ title: 'A' });
      const b = tasks.create({ title: 'B', parentId: a.id });
      const c = tasks.create({ title: 'C', parentId: b.id });

      // a -> b -> c -> a, a genuine cycle that `move` would never allow.
      ctx.db.$client.prepare('UPDATE task SET parent_id = ? WHERE id = ?').run(c.id, a.id);

      expect(() => tasks.complete(a.id)).not.toThrow();
    },
  );
});
