import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeAuthedApp, type AuthedApp } from '../../../test/helpers/testApp.js';

let ctx: AuthedApp;

beforeEach(async () => {
  ctx = await makeAuthedApp('2026-09-01T02:00:00Z');
});

afterEach(async () => {
  await ctx.close();
});

async function archivedTask(title: string) {
  const task = (await ctx.post('/api/tasks', { title })).json();
  await ctx.post(`/api/tasks/${task.id}/complete`);
  ctx.db.$client
    .prepare(`UPDATE task SET archived_at = '2026-09-02T18:00:00.000Z' WHERE root_id = ?`)
    .run(task.id);
  return task;
}

describe('GET /api/archive', () => {
  it('defaults to grouping by parent', async () => {
    await archivedTask('Plan trip');
    const res = await ctx.get('/api/archive');

    expect(res.statusCode).toBe(200);
    expect(res.json().groupBy).toBe('parent');
    expect(res.json().groups).toHaveLength(1);
  });

  it('groups by completion date when asked', async () => {
    await archivedTask('Plan trip');
    const res = await ctx.get('/api/archive?groupBy=completed');

    expect(res.json().groupBy).toBe('completed');
    // 2026-09-01T02:00Z is 11:00 JST the same day.
    expect(res.json().groups[0].date).toBe('2026-09-01');
  });

  it('rejects an unknown grouping with 400', async () => {
    expect((await ctx.get('/api/archive?groupBy=category')).statusCode).toBe(400);
  });

  it('requires a token', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/archive' })).statusCode).toBe(401);
  });
});
