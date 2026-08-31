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

describe('update', () => {
  it('changes only the fields present in the patch', () => {
    const task = tasks.create({ title: 'Buy milk', priority: 'must' });
    const updated = tasks.update(task.id, { title: 'Buy oat milk' });

    expect(updated.title).toBe('Buy oat milk');
    expect(updated.priority).toBe('must');
  });

  it('sets and clears the optional deadline', () => {
    const task = tasks.create({ title: 'File taxes' });
    expect(tasks.update(task.id, { dueDate: '2026-09-15' }).dueDate).toBe('2026-09-15');
    expect(tasks.update(task.id, { dueDate: null }).dueDate).toBeNull();
  });

  it('sets and clears the category', () => {
    ctx.db.$client
      .prepare(`INSERT INTO category (id, name, color, position, created_at) VALUES ('cat-1', 'Chores', '#4488ff', 0, '2026-08-31T00:00:00.000Z')`)
      .run();
    const task = tasks.create({ title: 'Laundry' });
    expect(tasks.update(task.id, { categoryId: 'cat-1' }).categoryId).toBe('cat-1');
    expect(tasks.update(task.id, { categoryId: null }).categoryId).toBeNull();
  });

  it('throws NotFound when categoryId does not exist', () => {
    const task = tasks.create({ title: 'Laundry' });
    expect(() => tasks.update(task.id, { categoryId: '11111111-1111-4111-8111-111111111111' })).toThrow(
      /not found/i,
    );
  });

  it('allows clearing categoryId to null without validating it', () => {
    ctx.db.$client
      .prepare(`INSERT INTO category (id, name, color, position, created_at) VALUES ('cat-1', 'Chores', '#4488ff', 0, '2026-08-31T00:00:00.000Z')`)
      .run();
    const task = tasks.create({ title: 'Laundry', categoryId: 'cat-1' });
    expect(tasks.update(task.id, { categoryId: null }).categoryId).toBeNull();
  });

  it('stamps notes_updated_at when the note text changes', () => {
    const task = tasks.create({ title: 'Fix sink' });
    expect(task.notesUpdatedAt).toBeNull();

    ctx.clock.set('2026-08-31T09:00:00Z');
    const updated = tasks.update(task.id, { notes: 'washer is worn' });

    expect(updated.notes).toBe('washer is worn');
    expect(updated.notesUpdatedAt).toBe('2026-08-31T09:00:00.000Z');
  });

  it('leaves notes_updated_at alone when the note text is unchanged', () => {
    const task = tasks.create({ title: 'Fix sink', notes: 'washer is worn' });
    const stampedAt = task.notesUpdatedAt;

    ctx.clock.set('2026-09-05T09:00:00Z');
    const updated = tasks.update(task.id, { notes: 'washer is worn' });

    expect(updated.notesUpdatedAt).toBe(stampedAt);
  });

  it('leaves notes_updated_at alone when only the title changes', () => {
    const task = tasks.create({ title: 'Fix sink', notes: 'washer is worn' });
    const stampedAt = task.notesUpdatedAt;

    ctx.clock.set('2026-09-05T09:00:00Z');
    const updated = tasks.update(task.id, { title: 'Fix the kitchen sink' });

    expect(updated.notesUpdatedAt).toBe(stampedAt);
  });

  it('clears notes_updated_at when the note is emptied', () => {
    const task = tasks.create({ title: 'Fix sink', notes: 'washer is worn' });
    const updated = tasks.update(task.id, { notes: null });

    expect(updated.notes).toBeNull();
    expect(updated.notesUpdatedAt).toBeNull();
  });

  it('treats an empty string as no note', () => {
    const task = tasks.create({ title: 'Fix sink', notes: 'washer is worn' });
    const updated = tasks.update(task.id, { notes: '' });

    expect(updated.notesUpdatedAt).toBeNull();
  });

  it('throws NotFound for an unknown id', () => {
    expect(() => tasks.update('11111111-1111-4111-8111-111111111111', { title: 'x' })).toThrow(/not found/i);
  });
});

describe('remove', () => {
  it('deletes the task and its whole subtree', () => {
    const root = tasks.create({ title: 'Plan trip' });
    const child = tasks.create({ title: 'Travel', parentId: root.id });
    const grandchild = tasks.create({ title: 'Book flights', parentId: child.id });

    tasks.remove(root.id);

    for (const id of [root.id, child.id, grandchild.id]) {
      expect(() => tasks.get(id)).toThrow(/not found/i);
    }
  });

  it('leaves siblings and the parent alone', () => {
    const root = tasks.create({ title: 'Plan trip' });
    const doomed = tasks.create({ title: 'Travel', parentId: root.id });
    const survivor = tasks.create({ title: 'Pack', parentId: root.id });

    tasks.remove(doomed.id);

    expect(tasks.get(root.id).id).toBe(root.id);
    expect(tasks.get(survivor.id).id).toBe(survivor.id);
  });

  it('throws NotFound for an unknown id', () => {
    expect(() => tasks.remove('11111111-1111-4111-8111-111111111111')).toThrow(/not found/i);
  });
});
