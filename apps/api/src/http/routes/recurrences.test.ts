import { Recurrence, RecurrenceHistory } from '@simple-todos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeAuthedApp, type AuthedApp } from '../../../test/helpers/testApp.js';

let ctx: AuthedApp;

beforeEach(async () => {
  ctx = await makeAuthedApp('2026-08-31T01:00:00Z');
});

afterEach(async () => {
  await ctx.close();
});

describe('/api/recurrences', () => {
  it('creates one and returns 201 matching the contract', async () => {
    const res = await ctx.post('/api/recurrences', { title: 'Exercise', scheduleKind: 'daily' });
    expect(res.statusCode).toBe(201);
    expect(Recurrence.safeParse(res.json()).success).toBe(true);
  });

  it('requires a token', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/recurrences' })).statusCode).toBe(401);
  });

  it('lists them', async () => {
    await ctx.post('/api/recurrences', { title: 'Exercise', scheduleKind: 'daily' });
    expect((await ctx.get('/api/recurrences')).json()).toHaveLength(1);
  });

  it('rejects a weekly schedule with no days, with 400', async () => {
    const res = await ctx.post('/api/recurrences', { title: 'Gym', scheduleKind: 'weekly' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an out-of-range weekday', async () => {
    for (const day of [0, 8]) {
      const res = await ctx.post('/api/recurrences', {
        title: 'Gym',
        scheduleKind: 'weekly',
        daysOfWeek: [day],
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('rejects an unknown categoryId with 404', async () => {
    const res = await ctx.post('/api/recurrences', {
      title: 'Exercise',
      scheduleKind: 'daily',
      categoryId: '11111111-1111-4111-8111-111111111111',
    });
    expect(res.statusCode).toBe(404);
  });

  it('pauses via PATCH active:false', async () => {
    const created = (await ctx.post('/api/recurrences', { title: 'Exercise', scheduleKind: 'daily' })).json();
    expect((await ctx.patch(`/api/recurrences/${created.id}`, { active: false })).json().active).toBe(false);
  });

  it('deletes and then 404s', async () => {
    const created = (await ctx.post('/api/recurrences', { title: 'Exercise', scheduleKind: 'daily' })).json();
    expect((await ctx.del(`/api/recurrences/${created.id}`)).statusCode).toBe(204);
    expect((await ctx.patch(`/api/recurrences/${created.id}`, { title: 'x' })).statusCode).toBe(404);
  });
});

describe('GET /api/recurrences/:id/history', () => {
  it('returns history matching the contract', async () => {
    const created = (await ctx.post('/api/recurrences', { title: 'Exercise', scheduleKind: 'daily' })).json();
    const res = await ctx.get(`/api/recurrences/${created.id}/history`);

    expect(res.statusCode).toBe(200);
    expect(RecurrenceHistory.safeParse(res.json()).success).toBe(true);
    expect(res.json()).toMatchObject({ entries: [], currentStreak: 0, longestStreak: 0 });
  });

  it('404s for an unknown habit', async () => {
    expect(
      (await ctx.get('/api/recurrences/11111111-1111-4111-8111-111111111111/history')).statusCode,
    ).toBe(404);
  });

  it('rejects an impossible from date with 400', async () => {
    const created = (await ctx.post('/api/recurrences', { title: 'Exercise', scheduleKind: 'daily' })).json();
    expect((await ctx.get(`/api/recurrences/${created.id}/history?from=2026-02-31`)).statusCode).toBe(400);
  });
});
