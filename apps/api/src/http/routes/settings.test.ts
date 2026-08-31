import { Settings } from '@simple-todos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeAuthedApp, type AuthedApp } from '../../../test/helpers/testApp.js';

let ctx: AuthedApp;

beforeEach(async () => {
  ctx = await makeAuthedApp();
});

afterEach(async () => {
  await ctx.close();
});

describe('/api/settings', () => {
  it('returns the current settings, matching the shared contract', async () => {
    const res = await ctx.get('/api/settings');
    expect(res.statusCode).toBe(200);
    expect(Settings.safeParse(res.json()).success).toBe(true);
    expect(res.json().timezone).toBe('Asia/Tokyo');
  });

  it('requires a token', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/settings' })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'PUT', url: '/api/settings' })).statusCode).toBe(401);
  });

  it('updates a field', async () => {
    const res = await ctx.request('PUT', '/api/settings', { sweepTime: '04:30' });
    expect(res.statusCode).toBe(200);
    expect(res.json().sweepTime).toBe('04:30');
  });

  it('rejects a malformed time with 400', async () => {
    expect((await ctx.request('PUT', '/api/settings', { sweepTime: '25:00' })).statusCode).toBe(400);
    expect((await ctx.request('PUT', '/api/settings', { sweepTime: '4:30' })).statusCode).toBe(400);
    expect((await ctx.request('PUT', '/api/settings', { sweepTime: '03:60' })).statusCode).toBe(400);
  });

  it('rejects an unknown timezone with 400', async () => {
    const res = await ctx.request('PUT', '/api/settings', { timezone: 'Not/AZone' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects enabling the reminder with no webhook, with 400', async () => {
    const res = await ctx.request('PUT', '/api/settings', { reminderEnabled: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a webhook url that is not a url', async () => {
    expect((await ctx.request('PUT', '/api/settings', { webhookUrl: 'not-a-url' })).statusCode).toBe(400);
  });

  it('rejects an unknown webhook kind', async () => {
    expect((await ctx.request('PUT', '/api/settings', { webhookKind: 'telegram' })).statusCode).toBe(400);
  });
});

describe('POST /api/settings/webhook/test', () => {
  it('409s when no webhook is configured', async () => {
    const res = await ctx.post('/api/settings/webhook/test');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('sends a sample payload and reports delivery', async () => {
    await ctx.request('PUT', '/api/settings', {
      webhookKind: 'slack',
      webhookUrl: 'https://example.test/hook',
    });

    const res = await ctx.post('/api/settings/webhook/test');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ delivered: true });
    expect(ctx.webhooks).toHaveLength(1);
    expect(ctx.webhooks[0]!.url).toBe('https://example.test/hook');
    expect(ctx.webhooks[0]!.body).toContain('test message');
  });

  it('reports failure rather than erroring when the webhook rejects', async () => {
    await ctx.request('PUT', '/api/settings', {
      webhookKind: 'discord',
      webhookUrl: 'https://example.test/hook',
    });
    ctx.setWebhookOutcome(false);

    const res = await ctx.post('/api/settings/webhook/test');

    expect(res.statusCode).toBe(200);
    expect(res.json().delivered).toBe(false);
  });
});
