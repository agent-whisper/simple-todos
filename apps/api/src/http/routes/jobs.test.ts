import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeAuthedApp, type AuthedApp } from '../../../test/helpers/testApp.js';

let ctx: AuthedApp;

beforeEach(async () => {
  ctx = await makeAuthedApp('2026-09-01T00:00:00Z');
});

afterEach(async () => {
  await ctx.close();
});

async function configureWebhook() {
  return ctx.request('PUT', '/api/settings', {
    webhookKind: 'discord',
    webhookUrl: 'https://example.test/hook',
  });
}

describe('POST /api/jobs/sweep/run', () => {
  it('runs the sweep for today and reports what it did', async () => {
    const task = (await ctx.post('/api/tasks', { title: 'Done thing' })).json();
    await ctx.post(`/api/tasks/${task.id}/complete`);

    const res = await ctx.post('/api/jobs/sweep/run');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ran: true, archived: 1 });
    expect((await ctx.get('/api/tasks')).json()).toEqual([]);
  });

  it('accepts an explicit date', async () => {
    expect((await ctx.post('/api/jobs/sweep/run', { date: '2026-09-02' })).statusCode).toBe(200);

    const rows = ctx.db.$client
      .prepare(`SELECT run_date FROM job_run WHERE job_name = 'sweep'`)
      .all() as { run_date: string }[];
    expect(rows).toEqual([{ run_date: '2026-09-02' }]);
  });

  it('reports ran:false when the date was already swept', async () => {
    await ctx.post('/api/jobs/sweep/run');
    expect((await ctx.post('/api/jobs/sweep/run')).json().ran).toBe(false);
  });

  it('rejects an impossible date with 400', async () => {
    expect((await ctx.post('/api/jobs/sweep/run', { date: '2026-02-31' })).statusCode).toBe(400);
  });

  it('requires a token', async () => {
    expect((await ctx.app.inject({ method: 'POST', url: '/api/jobs/sweep/run' })).statusCode).toBe(401);
  });
});

describe('POST /api/jobs/reminder/run', () => {
  it('409s when no webhook is configured', async () => {
    const res = await ctx.post('/api/jobs/reminder/run');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('reports delivery and the date it built the payload for', async () => {
    await configureWebhook();
    const res = await ctx.post('/api/jobs/reminder/run');

    expect(res.statusCode).toBe(200);
    // The stub fetch in the test app reports success.
    expect(res.json()).toEqual({ delivered: true, date: '2026-09-01' });
  });

  it('writes no job_run row, so a manual test does not suppress the real one', async () => {
    await configureWebhook();
    await ctx.post('/api/jobs/reminder/run');

    const rows = ctx.db.$client
      .prepare(`SELECT count(*) AS n FROM job_run WHERE job_name = 'reminder'`)
      .get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it('requires a token', async () => {
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/api/jobs/reminder/run' })).statusCode,
    ).toBe(401);
  });
});
