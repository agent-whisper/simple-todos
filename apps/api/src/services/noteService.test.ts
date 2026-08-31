import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';
import { CategoryService } from './categoryService.js';
import { NoteService } from './noteService.js';
import { TaskService } from './taskService.js';

let ctx: TestApp;
let tasks: TaskService;
let categories: CategoryService;
let notes: NoteService;

beforeEach(async () => {
  ctx = await makeTestApp('2026-08-31T01:00:00Z');
  tasks = new TaskService(ctx.db, ctx.clock);
  categories = new CategoryService(ctx.db, ctx.clock);
  notes = new NoteService(ctx.db);
});

afterEach(async () => {
  await ctx.close();
});

function archive(id: string) {
  ctx.db.$client
    .prepare(`UPDATE task SET completed_at = '2026-08-30T10:00:00.000Z', archived_at = '2026-08-31T18:00:00.000Z' WHERE id = ?`)
    .run(id);
}

describe('list', () => {
  it('returns only tasks that have a note', () => {
    tasks.create({ title: 'Fix sink', notes: 'washer is worn' });
    tasks.create({ title: 'Buy milk' });

    const result = notes.list({ status: 'all', limit: 50 });
    expect(result.notes.map((n) => n.title)).toEqual(['Fix sink']);
  });

  it('orders by the note timestamp, newest first', () => {
    ctx.clock.set('2026-08-01T00:00:00Z');
    tasks.create({ title: 'Older note', notes: 'first' });
    ctx.clock.set('2026-08-20T00:00:00Z');
    tasks.create({ title: 'Newer note', notes: 'second' });

    const result = notes.list({ status: 'all', limit: 50 });
    expect(result.notes.map((n) => n.title)).toEqual(['Newer note', 'Older note']);
  });

  it('floats an old note back to the top when it is edited', () => {
    ctx.clock.set('2026-08-01T00:00:00Z');
    const old = tasks.create({ title: 'Old task', notes: 'original' });
    ctx.clock.set('2026-08-20T00:00:00Z');
    tasks.create({ title: 'Newer task', notes: 'second' });

    ctx.clock.set('2026-09-01T00:00:00Z');
    tasks.update(old.id, { notes: 'revised' });

    const result = notes.list({ status: 'all', limit: 50 });
    expect(result.notes[0]!.title).toBe('Old task');
  });

  it('includes archived tasks, which is where the useful notes tend to live', () => {
    const task = tasks.create({ title: 'Deploy failed', notes: 'broke because of the DNS cache' });
    archive(task.id);

    const result = notes.list({ status: 'all', limit: 50 });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]!.status).toBe('archived');
  });

  it('labels an active task done when it is completed but not yet swept', () => {
    const task = tasks.create({ title: 'Fix sink', notes: 'washer is worn' });
    tasks.complete(task.id);

    expect(notes.list({ status: 'all', limit: 50 }).notes[0]!.status).toBe('done');
  });

  it('narrows to active or archived on request', () => {
    const active = tasks.create({ title: 'Active', notes: 'still going' });
    const archived = tasks.create({ title: 'Archived', notes: 'all done' });
    archive(archived.id);

    expect(notes.list({ status: 'active', limit: 50 }).notes.map((n) => n.taskId)).toEqual([active.id]);
    expect(notes.list({ status: 'archived', limit: 50 }).notes.map((n) => n.taskId)).toEqual([archived.id]);
  });

  it('searches note text case-insensitively', () => {
    tasks.create({ title: 'Fix sink', notes: 'the Washer is worn' });
    tasks.create({ title: 'Write spec', notes: 'needs a diagram' });

    expect(notes.list({ q: 'washer', status: 'all', limit: 50 }).notes).toHaveLength(1);
  });

  it('filters by category', () => {
    const chores = categories.create({ name: 'Chores', color: '#4488ff' });
    tasks.create({ title: 'Fix sink', notes: 'washer is worn', categoryId: chores.id });
    tasks.create({ title: 'Write spec', notes: 'needs a diagram' });

    const result = notes.list({ categoryId: chores.id, status: 'all', limit: 50 });
    expect(result.notes.map((n) => n.title)).toEqual(['Fix sink']);
  });

  it('carries the dates the page displays', () => {
    const task = tasks.create({ title: 'Fix sink', notes: 'washer is worn' });
    archive(task.id);

    const note = notes.list({ status: 'all', limit: 50 }).notes[0]!;
    expect(note.createdAt).toBe('2026-08-31T01:00:00.000Z');
    expect(note.completedAt).toBe('2026-08-30T10:00:00.000Z');
    expect(note.notesUpdatedAt).toBe('2026-08-31T01:00:00.000Z');
  });

  it('paginates', () => {
    for (let i = 0; i < 3; i += 1) {
      ctx.clock.set(`2026-08-0${i + 1}T00:00:00Z`);
      tasks.create({ title: `Task ${i}`, notes: `note ${i}` });
    }

    const first = notes.list({ status: 'all', limit: 2 });
    expect(first.notes).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = notes.list({ status: 'all', limit: 2, cursor: first.nextCursor! });
    expect(second.notes.map((n) => n.title)).toEqual(['Task 0']);
    expect(second.nextCursor).toBeNull();
  });

  it('returns nothing when no task has a note', () => {
    tasks.create({ title: 'Buy milk' });
    expect(notes.list({ status: 'all', limit: 50 }).notes).toEqual([]);
  });

  it('does not drop a row when two notes tie on the exact same instant', () => {
    ctx.clock.set('2026-08-15T00:00:00Z');
    const a = tasks.create({ title: 'Task A', notes: 'note a' });
    const b = tasks.create({ title: 'Task B', notes: 'note b' });

    const first = notes.list({ status: 'all', limit: 1 });
    expect(first.notes).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();

    const second = notes.list({ status: 'all', limit: 1, cursor: first.nextCursor! });
    expect(second.notes).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const seenIds = [first.notes[0]!.taskId, second.notes[0]!.taskId].sort();
    expect(seenIds).toEqual([a.id, b.id].sort());
  });

  it('rejects a malformed cursor with a 400 instead of silently mis-filtering', () => {
    expect(() => notes.list({ status: 'all', limit: 50, cursor: 'not-a-real-cursor!!' })).toThrow();
  });
});
