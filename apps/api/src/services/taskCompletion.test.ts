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

/** root → mid → leaf, plus a second child of root. */
function makeTree() {
  const root = tasks.create({ title: 'Plan trip' });
  const mid = tasks.create({ title: 'Travel', parentId: root.id });
  const leaf = tasks.create({ title: 'Book flights', parentId: mid.id });
  const sibling = tasks.create({ title: 'Pack', parentId: root.id });
  return { root, mid, leaf, sibling };
}

function archiveTree(rootId: string, at: string) {
  ctx.db.$client.prepare(`UPDATE task SET archived_at = ? WHERE root_id = ?`).run(at, rootId);
}

describe('complete', () => {
  it('stamps completed_at from the clock', () => {
    const task = tasks.create({ title: 'Buy milk' });
    expect(tasks.complete(task.id).completedAt).toBe('2026-08-31T01:00:00.000Z');
  });

  it('cascades down to every descendant (invariant 1)', () => {
    const { root, mid, leaf, sibling } = makeTree();
    tasks.complete(root.id);

    for (const id of [root.id, mid.id, leaf.id, sibling.id]) {
      expect(tasks.get(id).completedAt).not.toBeNull();
    }
  });

  it('completes a subtree without touching its parent', () => {
    const { root, mid, leaf } = makeTree();
    tasks.complete(mid.id);

    expect(tasks.get(mid.id).completedAt).not.toBeNull();
    expect(tasks.get(leaf.id).completedAt).not.toBeNull();
    expect(tasks.get(root.id).completedAt).toBeNull();
  });

  it('leaves an already-completed descendant timestamp alone', () => {
    const { root, mid } = makeTree();
    tasks.complete(mid.id);
    const midCompletedAt = tasks.get(mid.id).completedAt;

    ctx.clock.set('2026-08-31T05:00:00Z');
    tasks.complete(root.id);

    expect(tasks.get(mid.id).completedAt).toBe(midCompletedAt);
    expect(tasks.get(root.id).completedAt).toBe('2026-08-31T05:00:00.000Z');
  });

  it('does not archive anything; that is the sweep\'s job', () => {
    const { root } = makeTree();
    tasks.complete(root.id);
    expect(tasks.get(root.id).archivedAt).toBeNull();
  });

  it('throws NotFound for an unknown id', () => {
    expect(() => tasks.complete('11111111-1111-4111-8111-111111111111')).toThrow(/not found/i);
  });
});

describe('uncomplete', () => {
  it('clears completed_at on the task', () => {
    const task = tasks.create({ title: 'Buy milk' });
    tasks.complete(task.id);
    expect(tasks.uncomplete(task.id).completedAt).toBeNull();
  });

  it('cascades up to every ancestor, preserving invariant 1', () => {
    const { root, mid, leaf } = makeTree();
    tasks.complete(root.id);

    tasks.uncomplete(leaf.id);

    expect(tasks.get(leaf.id).completedAt).toBeNull();
    expect(tasks.get(mid.id).completedAt).toBeNull();
    expect(tasks.get(root.id).completedAt).toBeNull();
  });

  it('leaves descendants and siblings completed', () => {
    const { root, mid, leaf, sibling } = makeTree();
    tasks.complete(root.id);

    tasks.uncomplete(mid.id);

    expect(tasks.get(leaf.id).completedAt).not.toBeNull();
    expect(tasks.get(sibling.id).completedAt).not.toBeNull();
    expect(tasks.get(root.id).completedAt).toBeNull();
  });

  it('returns an archived tree to the active list, whole (invariant 3)', () => {
    const { root, mid, leaf, sibling } = makeTree();
    tasks.complete(root.id);
    archiveTree(root.id, '2026-09-01T18:00:00.000Z');

    tasks.uncomplete(leaf.id);

    for (const id of [root.id, mid.id, leaf.id, sibling.id]) {
      expect(tasks.get(id).archivedAt).toBeNull();
    }
  });

  it('never leaves an archived task uncompleted (invariant 2)', () => {
    const { root, leaf } = makeTree();
    tasks.complete(root.id);
    archiveTree(root.id, '2026-09-01T18:00:00.000Z');

    tasks.uncomplete(leaf.id);

    const violations = ctx.db.$client
      .prepare(`SELECT count(*) AS n FROM task WHERE archived_at IS NOT NULL AND completed_at IS NULL`)
      .get() as { n: number };
    expect(violations.n).toBe(0);
  });

  it('is a no-op on a task that was never completed', () => {
    const task = tasks.create({ title: 'Buy milk' });
    expect(tasks.uncomplete(task.id).completedAt).toBeNull();
  });
});
