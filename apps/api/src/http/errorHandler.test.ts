import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConflictError, NotFoundError } from '../domain/errors.js';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';

let app: FastifyInstance;
let ctx: TestApp;

beforeEach(async () => {
  ctx = await makeTestApp();
  app = ctx.app;

  app.get('/api/boom', async () => {
    throw new Error('a secret internal detail');
  });
  app.get('/api/missing', async () => {
    throw new NotFoundError('task', 'task-9');
  });
  app.get('/api/conflict', async () => {
    throw new ConflictError('that move would create a cycle');
  });
  app.get('/api/invalid', async () => {
    z.object({ title: z.string().min(1) }).parse({ title: '' });
  });
});

afterEach(async () => {
  await ctx.close();
});

describe('health', () => {
  it('answers without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('error envelope', () => {
  it('maps NotFoundError to 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/missing' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'task task-9 not found' } });
  });

  it('maps ConflictError to 409', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/conflict' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('maps a Zod failure to 400 with field paths', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invalid' });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual([{ path: 'title', message: expect.any(String) }]);
  });

  it('maps an unexpected throw to 500 and leaks nothing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/boom' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(body)).not.toContain('a secret internal detail');
  });

  it('returns the envelope for an unknown route', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('maps a rate-limit rejection to 429 with RATE_LIMITED, not CONFLICT', async () => {
    app.get(
      '/api/limited',
      { config: { rateLimit: { max: 1, timeWindow: '1 minute' } } },
      async () => ({ ok: true }),
    );

    const first = await app.inject({ method: 'GET', url: '/api/limited' });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'GET', url: '/api/limited' });
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe('RATE_LIMITED');
  });
});
