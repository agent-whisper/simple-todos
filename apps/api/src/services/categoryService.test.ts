import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';
import { CategoryService } from './categoryService.js';
import { TaskService } from './taskService.js';

let ctx: TestApp;
let categories: CategoryService;
let tasks: TaskService;

beforeEach(async () => {
  ctx = await makeTestApp('2026-08-31T01:00:00Z');
  categories = new CategoryService(ctx.db, ctx.clock);
  tasks = new TaskService(ctx.db, ctx.clock);
});

afterEach(async () => {
  await ctx.close();
});

describe('create', () => {
  it('stores a category with its colour', () => {
    const created = categories.create({ name: 'Exercise', color: '#22aa66' });
    expect(created).toMatchObject({ name: 'Exercise', color: '#22aa66' });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('appends each new category after the last', () => {
    const first = categories.create({ name: 'Exercise', color: '#22aa66' });
    const second = categories.create({ name: 'Chores', color: '#4488ff' });
    expect(second.position).toBeGreaterThan(first.position);
  });

  it('rejects a duplicate name regardless of case', () => {
    categories.create({ name: 'Chores', color: '#4488ff' });
    expect(() => categories.create({ name: 'chores', color: '#ff0000' })).toThrow(/already exists/i);
  });
});

describe('list', () => {
  it('returns categories in position order', () => {
    categories.create({ name: 'Exercise', color: '#22aa66' });
    categories.create({ name: 'Chores', color: '#4488ff' });
    expect(categories.list().map((c) => c.name)).toEqual(['Exercise', 'Chores']);
  });

  it('returns an empty array when there are none', () => {
    expect(categories.list()).toEqual([]);
  });
});

describe('update', () => {
  it('renames a category in one place, affecting every task at once', () => {
    const category = categories.create({ name: 'Project A', color: '#4488ff' });
    const task = tasks.create({ title: 'Ship it', categoryId: category.id });

    categories.update(category.id, { name: 'Project Aurora' });

    expect(categories.list()[0]!.name).toBe('Project Aurora');
    expect(tasks.get(task.id).categoryId).toBe(category.id);
  });

  it('recolours a category', () => {
    const category = categories.create({ name: 'Chores', color: '#4488ff' });
    expect(categories.update(category.id, { color: '#ff8800' }).color).toBe('#ff8800');
  });

  it('rejects a rename that collides with another category', () => {
    categories.create({ name: 'Exercise', color: '#22aa66' });
    const chores = categories.create({ name: 'Chores', color: '#4488ff' });
    expect(() => categories.update(chores.id, { name: 'exercise' })).toThrow(/already exists/i);
  });

  it('allows a category to keep its own name', () => {
    const category = categories.create({ name: 'Chores', color: '#4488ff' });
    expect(() => categories.update(category.id, { name: 'Chores', color: '#ff8800' })).not.toThrow();
  });

  it('throws NotFound for an unknown id', () => {
    expect(() => categories.update('11111111-1111-4111-8111-111111111111', { name: 'x' })).toThrow(/not found/i);
  });
});

describe('remove', () => {
  it('leaves its tasks in place, uncategorised', () => {
    const category = categories.create({ name: 'Chores', color: '#4488ff' });
    const task = tasks.create({ title: 'Laundry', categoryId: category.id });

    categories.remove(category.id);

    expect(tasks.get(task.id).categoryId).toBeNull();
    expect(tasks.get(task.id).title).toBe('Laundry');
  });

  it('throws NotFound for an unknown id', () => {
    expect(() => categories.remove('11111111-1111-4111-8111-111111111111')).toThrow(/not found/i);
  });
});

describe('reordering', () => {
  function seed(...names: string[]) {
    return names.map((name) => categories.create({ name, color: '#28407a' }));
  }

  const order = () => categories.list().map((c) => c.name);

  // `position` is an index into the list AS DISPLAYED, with the moved category
  // still in it — the same reading move() takes for tasks, and what a drop
  // between two headings means.
  it('moves a category later in the list', () => {
    const [a] = seed('A', 'B', 'C', 'D');

    // Index 2 is the gap between B and C.
    categories.move(a!.id, 2);

    expect(order()).toEqual(['B', 'A', 'C', 'D']);
  });

  it('moves a category earlier in the list', () => {
    const made = seed('A', 'B', 'C', 'D');

    categories.move(made[3]!.id, 1);

    expect(order()).toEqual(['A', 'D', 'B', 'C']);
  });

  it('moves a category to the end', () => {
    const [a] = seed('A', 'B', 'C');

    categories.move(a!.id, 3);

    expect(order()).toEqual(['B', 'C', 'A']);
  });

  it('leaves the order alone when dropped back where it was', () => {
    const made = seed('A', 'B', 'C');

    categories.move(made[1]!.id, 1);

    expect(order()).toEqual(['A', 'B', 'C']);
  });

  it('keeps positions dense, so the next move can index them directly', () => {
    const [a] = seed('A', 'B', 'C');

    categories.move(a!.id, 2);

    expect(categories.list().map((c) => c.position)).toEqual([0, 1, 2]);
  });

  it('survives a run of moves without the order drifting', () => {
    const made = seed('A', 'B', 'C', 'D');

    categories.move(made[0]!.id, 3);
    categories.move(made[3]!.id, 0);
    categories.move(made[2]!.id, 1);

    expect(order()).toEqual(['D', 'C', 'B', 'A']);
    expect(categories.list().map((c) => c.position)).toEqual([0, 1, 2, 3]);
  });

  it('refuses to move something that is not there', () => {
    expect(() => categories.move('11111111-1111-4111-8111-111111111111', 0)).toThrow(/not found/i);
  });
});
