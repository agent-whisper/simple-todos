import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeAuthedApp, type AuthedApp } from '../../../test/helpers/testApp.js';

let ctx: AuthedApp;

beforeEach(async () => {
  ctx = await makeAuthedApp();
});

afterEach(async () => {
  await ctx.close();
});

describe('/api/categories', () => {
  it('creates and lists categories', async () => {
    const created = await ctx.post('/api/categories', { name: 'Exercise', color: '#22aa66' });
    expect(created.statusCode).toBe(201);

    const listed = await ctx.get('/api/categories');
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0].name).toBe('Exercise');
  });

  it('requires a token', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/categories' })).statusCode).toBe(401);
  });

  it('rejects a malformed colour with 400', async () => {
    const res = await ctx.post('/api/categories', { name: 'Exercise', color: 'green' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 for a duplicate name', async () => {
    await ctx.post('/api/categories', { name: 'Chores', color: '#4488ff' });
    const res = await ctx.post('/api/categories', { name: 'chores', color: '#ff0000' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('renames a category', async () => {
    const created = (await ctx.post('/api/categories', { name: 'Project A', color: '#4488ff' })).json();
    const res = await ctx.patch(`/api/categories/${created.id}`, { name: 'Project Aurora' });
    expect(res.json().name).toBe('Project Aurora');
  });

  it('deletes a category and leaves its task uncategorised', async () => {
    const category = (await ctx.post('/api/categories', { name: 'Chores', color: '#4488ff' })).json();
    const task = (await ctx.post('/api/tasks', { title: 'Laundry', categoryId: category.id })).json();

    expect((await ctx.del(`/api/categories/${category.id}`)).statusCode).toBe(204);

    const fetched = await ctx.get(`/api/tasks/${task.id}`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().categoryId).toBeNull();
  });
});
