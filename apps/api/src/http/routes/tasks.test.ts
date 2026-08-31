import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeAuthedApp, type AuthedApp } from '../../../test/helpers/testApp.js';

let ctx: AuthedApp;

beforeEach(async () => {
  ctx = await makeAuthedApp();
});

afterEach(async () => {
  await ctx.close();
});

describe('POST /api/tasks', () => {
  it('creates a task and returns 201', async () => {
    const res = await ctx.post('/api/tasks', { title: 'Buy milk' });
    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe('Buy milk');
  });

  it('requires a token', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'Buy milk' } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an empty title', async () => {
    const res = await ctx.post('/api/tasks', { title: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unknown parent with 404', async () => {
    const res = await ctx.post('/api/tasks', {
      title: 'Orphan',
      parentId: '11111111-1111-4111-8111-111111111111',
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an unknown categoryId with 404, not 500', async () => {
    const res = await ctx.post('/api/tasks', {
      title: 'Buy milk',
      categoryId: '11111111-1111-4111-8111-111111111111',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('rejects a parentId pointing at an archived task with 409', async () => {
    const parent = (await ctx.post('/api/tasks', { title: 'Old thing' })).json();
    ctx.db.$client
      .prepare(`UPDATE task SET completed_at = ?, archived_at = ? WHERE id = ?`)
      .run('2026-08-30T10:00:00.000Z', '2026-08-31T18:00:00.000Z', parent.id);

    const res = await ctx.post('/api/tasks', { title: 'Orphan', parentId: parent.id });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });
});

describe('GET /api/tasks', () => {
  it('returns the nested active tree', async () => {
    const parent = (await ctx.post('/api/tasks', { title: 'Plan trip' })).json();
    await ctx.post('/api/tasks', { title: 'Book flights', parentId: parent.id });

    const res = await ctx.get('/api/tasks');
    expect(res.statusCode).toBe(200);
    const tree = res.json();
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].title).toBe('Book flights');
  });

  it('requires a token', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/tasks' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/tasks/:id', () => {
  it('returns one task', async () => {
    const created = (await ctx.post('/api/tasks', { title: 'Buy milk' })).json();
    const res = await ctx.get(`/api/tasks/${created.id}`);
    expect(res.json().title).toBe('Buy milk');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await ctx.get('/api/tasks/11111111-1111-4111-8111-111111111111');
    expect(res.statusCode).toBe(404);
  });
});
