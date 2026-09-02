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

  it('still allows moving a task under a parent that is completed but not archived, and reopens the parent (invariant 1)', () => {
    const doneToday = tasks.create({ title: 'Done today' });
    ctx.db.$client.prepare(`UPDATE task SET completed_at = ? WHERE id = ?`).run('2026-08-31T09:00:00.000Z', doneToday.id);
    const lateAddition = tasks.create({ title: 'Late addition' });

    const moved = tasks.move(lateAddition.id, doneToday.id, 0);

    expect(moved.parentId).toBe(doneToday.id);
    expect(tasks.get(doneToday.id).completedAt).toBeNull();
  });

  it('reopens a completed grandparent and parent when a moved task lands under the completed parent', () => {
    const grandparent = tasks.create({ title: 'Grandparent' });
    const parent = tasks.create({ title: 'Parent', parentId: grandparent.id });
    ctx.db.$client
      .prepare(`UPDATE task SET completed_at = ? WHERE id IN (?, ?)`)
      .run('2026-08-31T09:00:00.000Z', grandparent.id, parent.id);
    const lateAddition = tasks.create({ title: 'Late addition' });

    tasks.move(lateAddition.id, parent.id, 0);

    expect(tasks.get(parent.id).completedAt).toBeNull();
    expect(tasks.get(grandparent.id).completedAt).toBeNull();
  });

  it('leaves the moved subtree\'s own completion state untouched when it lands under a completed parent', () => {
    const doneToday = tasks.create({ title: 'Done today' });
    ctx.db.$client.prepare(`UPDATE task SET completed_at = ? WHERE id = ?`).run('2026-08-31T09:00:00.000Z', doneToday.id);
    const alsoDone = tasks.create({ title: 'Also done' });
    ctx.db.$client.prepare(`UPDATE task SET completed_at = ? WHERE id = ?`).run('2026-08-31T08:00:00.000Z', alsoDone.id);

    tasks.move(alsoDone.id, doneToday.id, 0);

    expect(tasks.get(alsoDone.id).completedAt).toBe('2026-08-31T08:00:00.000Z');
  });

  it('rejects moving an archived task, even under an active parent (invariant 3)', () => {
    const archivedRoot = tasks.create({ title: 'Archived root' });
    ctx.db.$client
      .prepare(`UPDATE task SET completed_at = ?, archived_at = ? WHERE id = ?`)
      .run('2026-08-30T10:00:00.000Z', '2026-08-31T18:00:00.000Z', archivedRoot.id);
    const activeParent = tasks.create({ title: 'Active parent' });

    expect(() => tasks.move(archivedRoot.id, activeParent.id, 0)).toThrow(/archived/i);

    // Rejected — leaves the tree exactly as it was.
    expect(tasks.get(archivedRoot.id).parentId).toBeNull();
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

describe('move with a category', () => {
  it('sets the category as part of the same move', () => {
    ctx.db.$client
      .prepare(
        `INSERT INTO category (id, name, color, position, created_at)
         VALUES ('cat-1', 'Chores', '#4488ff', 0, '2026-08-31T00:00:00.000Z')`,
      )
      .run();
    const task = tasks.create({ title: 'Laundry' });

    const moved = tasks.move(task.id, null, 0, 'cat-1');

    expect(moved.categoryId).toBe('cat-1');
  });

  it('clears the category when passed null', () => {
    ctx.db.$client
      .prepare(
        `INSERT INTO category (id, name, color, position, created_at)
         VALUES ('cat-1', 'Chores', '#4488ff', 0, '2026-08-31T00:00:00.000Z')`,
      )
      .run();
    const task = tasks.create({ title: 'Laundry', categoryId: 'cat-1' });

    expect(tasks.move(task.id, null, 0, null).categoryId).toBeNull();
  });

  it('leaves the category alone when not mentioned', () => {
    ctx.db.$client
      .prepare(
        `INSERT INTO category (id, name, color, position, created_at)
         VALUES ('cat-1', 'Chores', '#4488ff', 0, '2026-08-31T00:00:00.000Z')`,
      )
      .run();
    const task = tasks.create({ title: 'Laundry', categoryId: 'cat-1' });

    // undefined means "not part of this move", which is different from null.
    expect(tasks.move(task.id, null, 0).categoryId).toBe('cat-1');
  });

  it('rejects an unknown category without moving anything', () => {
    const a = tasks.create({ title: 'A' });
    const b = tasks.create({ title: 'B' });

    expect(() => tasks.move(b.id, a.id, 0, '11111111-1111-4111-8111-111111111111')).toThrow(
      /not found/i,
    );
    expect(tasks.get(b.id).parentId).toBeNull();
  });

  it('leaves descendants their own categories', () => {
    ctx.db.$client
      .prepare(
        `INSERT INTO category (id, name, color, position, created_at)
         VALUES ('cat-1', 'Chores', '#4488ff', 0, '2026-08-31T00:00:00.000Z')`,
      )
      .run();
    const root = tasks.create({ title: 'Root' });
    const child = tasks.create({ title: 'Child', parentId: root.id });

    tasks.move(root.id, null, 0, 'cat-1');

    // Grouping keys off the root, so a descendant keeps whatever it had.
    expect(tasks.get(child.id).categoryId).toBeNull();
  });
});

describe('display order', () => {
  /** Sibling titles in the order the list endpoint returns them. */
  function order(parentId: string | null): string[] {
    const roots = tasks.listActive({});
    if (parentId === null) return roots.map((t) => t.title);
    const find = (nodes: typeof roots): typeof roots | null => {
      for (const n of nodes) {
        if (n.id === parentId) return n.children;
        const hit = find(n.children);
        if (hit) return hit;
      }
      return null;
    };
    return (find(roots) ?? []).map((t) => t.title);
  }

  // `position` is an index into the sibling list AS DISPLAYED, with the moved
  // task still in it — which is what a drop between two rows means: land here,
  // between these two.
  it('moves a task later among its siblings', () => {
    const a = tasks.create({ title: 'A' });
    tasks.create({ title: 'B' });
    tasks.create({ title: 'C' });
    tasks.create({ title: 'D' });

    // Index 2 is the gap between B and C.
    tasks.move(a.id, null, 2);

    expect(order(null)).toEqual(['B', 'A', 'C', 'D']);
  });

  it('moves a task earlier among its siblings', () => {
    tasks.create({ title: 'A' });
    tasks.create({ title: 'B' });
    tasks.create({ title: 'C' });
    const d = tasks.create({ title: 'D' });

    tasks.move(d.id, null, 1);

    expect(order(null)).toEqual(['A', 'D', 'B', 'C']);
  });

  it('moves a task to the very end', () => {
    const a = tasks.create({ title: 'A' });
    tasks.create({ title: 'B' });
    tasks.create({ title: 'C' });

    tasks.move(a.id, null, 3);

    expect(order(null)).toEqual(['B', 'C', 'A']);
  });

  it('keeps sibling positions dense, so the next move can index them directly', () => {
    const a = tasks.create({ title: 'A' });
    tasks.create({ title: 'B' });
    tasks.create({ title: 'C' });

    tasks.move(a.id, null, 2);

    const positions = tasks
      .listActive({})
      .map((t) => t.position)
      .sort((x, y) => x - y);
    expect(positions).toEqual([0, 1, 2]);
  });

  it('closes the hole left behind in the old sibling list', () => {
    const parent = tasks.create({ title: 'Parent' });
    tasks.create({ title: 'X', parentId: parent.id });
    const y = tasks.create({ title: 'Y', parentId: parent.id });
    tasks.create({ title: 'Z', parentId: parent.id });

    tasks.move(y.id, null, 0);

    const siblings = tasks.listActive({}).find((t) => t.id === parent.id)!.children;
    expect(siblings.map((t) => t.title)).toEqual(['X', 'Z']);
    expect(siblings.map((t) => t.position)).toEqual([0, 1]);
  });

  it('inserts into a new parent at the asked-for index', () => {
    const parent = tasks.create({ title: 'Parent' });
    tasks.create({ title: 'X', parentId: parent.id });
    tasks.create({ title: 'Z', parentId: parent.id });
    const y = tasks.create({ title: 'Y' });

    tasks.move(y.id, parent.id, 1);

    expect(order(parent.id)).toEqual(['X', 'Y', 'Z']);
  });
});
