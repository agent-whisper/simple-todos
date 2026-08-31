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

function makeCategory(id: string, name: string) {
  ctx.db.$client
    .prepare(`INSERT INTO category (id, name, color, position, created_at) VALUES (?, ?, '#4488ff', 0, '2026-08-31T00:00:00.000Z')`)
    .run(id, name);
}

describe('create', () => {
  it('stores a root task with defaults and stamps created_at from the clock', () => {
    const task = tasks.create({ title: 'Buy milk' });
    expect(task.title).toBe('Buy milk');
    expect(task.priority).toBe('should');
    expect(task.parentId).toBeNull();
    expect(task.completedAt).toBeNull();
    expect(task.archivedAt).toBeNull();
    expect(task.createdAt).toBe('2026-08-31T01:00:00.000Z');
  });

  it('makes a root its own root_id', () => {
    const task = tasks.create({ title: 'Buy milk' });
    expect(task.rootId).toBe(task.id);
  });

  it('gives a subtask its parent root_id', () => {
    const parent = tasks.create({ title: 'Plan trip' });
    const child = tasks.create({ title: 'Book flights', parentId: parent.id });
    expect(child.rootId).toBe(parent.id);
    expect(child.parentId).toBe(parent.id);
  });

  it('carries root_id down three levels', () => {
    const root = tasks.create({ title: 'Plan trip' });
    const mid = tasks.create({ title: 'Travel', parentId: root.id });
    const leaf = tasks.create({ title: 'Book flights', parentId: mid.id });
    expect(leaf.rootId).toBe(root.id);
  });

  it('defaults a subtask to its parent category', () => {
    makeCategory('cat-1', 'Project A');
    const parent = tasks.create({ title: 'Plan trip', categoryId: 'cat-1' });
    const child = tasks.create({ title: 'Book flights', parentId: parent.id });
    expect(child.categoryId).toBe('cat-1');
  });

  it('lets an explicit category override the parent default', () => {
    makeCategory('cat-1', 'Project A');
    makeCategory('cat-2', 'Chores');
    const parent = tasks.create({ title: 'Plan trip', categoryId: 'cat-1' });
    const child = tasks.create({ title: 'Laundry', parentId: parent.id, categoryId: 'cat-2' });
    expect(child.categoryId).toBe('cat-2');
  });

  it('appends each new sibling after the last', () => {
    const parent = tasks.create({ title: 'Plan trip' });
    const first = tasks.create({ title: 'One', parentId: parent.id });
    const second = tasks.create({ title: 'Two', parentId: parent.id });
    expect(second.position).toBeGreaterThan(first.position);
  });

  it('stamps notes_updated_at when created with a note, and leaves it null otherwise', () => {
    const withNote = tasks.create({ title: 'Fix sink', notes: 'washer is worn' });
    expect(withNote.notesUpdatedAt).toBe('2026-08-31T01:00:00.000Z');
    const without = tasks.create({ title: 'Buy milk' });
    expect(without.notesUpdatedAt).toBeNull();
  });

  it('rejects an unknown parent', () => {
    expect(() => tasks.create({ title: 'Orphan', parentId: '11111111-1111-4111-8111-111111111111' })).toThrow(
      /not found/i,
    );
  });
});

describe('listActive', () => {
  it('returns nested trees', () => {
    const parent = tasks.create({ title: 'Plan trip' });
    tasks.create({ title: 'Book flights', parentId: parent.id });

    const tree = tasks.listActive({});
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.title).toBe('Book flights');
  });

  it('excludes archived tasks', () => {
    const task = tasks.create({ title: 'Old thing' });
    ctx.db.$client
      .prepare(`UPDATE task SET completed_at = ?, archived_at = ? WHERE id = ?`)
      .run('2026-08-30T10:00:00.000Z', '2026-08-31T18:00:00.000Z', task.id);

    expect(tasks.listActive({})).toEqual([]);
  });

  it('keeps completed-but-unarchived tasks in the list', () => {
    const task = tasks.create({ title: 'Done today' });
    ctx.db.$client.prepare(`UPDATE task SET completed_at = ? WHERE id = ?`).run('2026-08-31T09:00:00.000Z', task.id);

    const tree = tasks.listActive({});
    expect(tree).toHaveLength(1);
    expect(tree[0]!.completedAt).toBe('2026-08-31T09:00:00.000Z');
  });

  it('returns an empty array when there is nothing', () => {
    expect(tasks.listActive({})).toEqual([]);
  });
});

describe('get', () => {
  it('returns a task by id', () => {
    const created = tasks.create({ title: 'Buy milk' });
    expect(tasks.get(created.id).title).toBe('Buy milk');
  });

  it('throws NotFound for an unknown id', () => {
    expect(() => tasks.get('11111111-1111-4111-8111-111111111111')).toThrow(/not found/i);
  });
});
