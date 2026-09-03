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

describe('marking what you are working on', () => {
  it('starts with nothing being worked on', () => {
    expect(tasks.create({ title: 'A' }).workingOnAt).toBeNull();
  });

  it('records when you started, not merely that you did', () => {
    const task = tasks.create({ title: 'A' });

    const updated = tasks.update(task.id, { workingOn: true });

    // A timestamp rather than a flag: the focus list is worth ordering by how
    // long something has been sitting there.
    expect(updated.workingOnAt).toBe(ctx.clock.now().toISOString());
  });

  it('clears it again', () => {
    const task = tasks.create({ title: 'A' });
    tasks.update(task.id, { workingOn: true });

    expect(tasks.update(task.id, { workingOn: false }).workingOnAt).toBeNull();
  });

  it('leaves it alone when the patch does not mention it', () => {
    const task = tasks.create({ title: 'A' });
    const started = tasks.update(task.id, { workingOn: true }).workingOnAt;

    expect(tasks.update(task.id, { title: 'A renamed' }).workingOnAt).toBe(started);
  });

  it('does not restart the clock on a task already being worked on', () => {
    const task = tasks.create({ title: 'A' });
    const started = tasks.update(task.id, { workingOn: true }).workingOnAt;
    ctx.clock.set('2026-08-31T02:00:00Z');

    expect(tasks.update(task.id, { workingOn: true }).workingOnAt).toBe(started);
  });

  it('stops being worked on once it is filed away', () => {
    const task = tasks.create({ title: 'A' });
    tasks.update(task.id, { workingOn: true });

    tasks.archive(task.id);

    // Archived means done. Nothing done is still being worked on.
    expect(tasks.get(task.id).workingOnAt).toBeNull();
  });

  it('clears it across the whole archived tree, not just the root', () => {
    const root = tasks.create({ title: 'Root' });
    const child = tasks.create({ title: 'Child', parentId: root.id });
    tasks.update(child.id, { workingOn: true });

    tasks.archive(root.id);

    expect(tasks.get(child.id).workingOnAt).toBeNull();
  });
});

describe('listing what you are working on', () => {
  it('returns only the flagged tasks', () => {
    const a = tasks.create({ title: 'Flagged' });
    tasks.create({ title: 'Not flagged' });
    tasks.update(a.id, { workingOn: true });

    const roots = tasks.listActive({ workingOn: true });

    expect(roots.map((t) => t.title)).toEqual(['Flagged']);
  });

  it('brings the trail of parents down to a flagged subtask', () => {
    const root = tasks.create({ title: 'Project' });
    const step = tasks.create({ title: 'The step', parentId: root.id });
    tasks.update(step.id, { workingOn: true });

    const roots = tasks.listActive({ workingOn: true });

    expect(roots.map((t) => t.title)).toEqual(['Project']);
    expect(roots[0]!.children.map((t) => t.title)).toEqual(['The step']);
  });

  it('leaves archived work off the list', () => {
    const a = tasks.create({ title: 'Flagged' });
    tasks.update(a.id, { workingOn: true });
    tasks.archive(a.id);

    expect(tasks.listActive({ workingOn: true })).toEqual([]);
  });

  it('still returns everything when the filter is not asked for', () => {
    const a = tasks.create({ title: 'Flagged' });
    tasks.create({ title: 'Not flagged' });
    tasks.update(a.id, { workingOn: true });

    expect(tasks.listActive({}).map((t) => t.title).sort()).toEqual(['Flagged', 'Not flagged']);
  });
});

describe('the stamp survives the trip through the list query', () => {
  // listActive names its columns one by one rather than selecting *, so a new
  // column is only in the response if it was added there too. Asserting titles
  // alone let a missing column through.
  it('carries workingOnAt on a flagged task', () => {
    const task = tasks.create({ title: 'Flagged' });
    tasks.update(task.id, { workingOn: true });

    const [root] = tasks.listActive({});

    expect(root!.workingOnAt).toBe(ctx.clock.now().toISOString());
  });

  it('carries an explicit null on one that is not flagged', () => {
    tasks.create({ title: 'Plain' });

    const [root] = tasks.listActive({});

    // Undefined would read as "being worked on" to anything testing !== null.
    expect(root).toHaveProperty('workingOnAt', null);
  });

  it('carries it on a nested task too', () => {
    const root = tasks.create({ title: 'Root' });
    const child = tasks.create({ title: 'Child', parentId: root.id });
    tasks.update(child.id, { workingOn: true });

    expect(tasks.listActive({})[0]!.children[0]!.workingOnAt).not.toBeUndefined();
  });
});
