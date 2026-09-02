import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';

let ctx: TestApp;
let root: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'spa-'));
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>simple-todos</title>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
  ctx = await makeTestApp(undefined, { staticRoot: root });
});

afterEach(async () => {
  await ctx.close();
  rmSync(root, { recursive: true, force: true });
});

describe('serving the SPA', () => {
  it('serves index.html at the root', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('simple-todos');
  });

  it('serves a built asset', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/assets/app.js' })).statusCode).toBe(200);
  });

  it('falls back to index.html for a client route, so deep links work', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/archive' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('simple-todos');
  });

  it('does NOT swallow unknown API routes into the SPA', async () => {
    // A 404 under /api must stay a JSON 404, or every client bug returns a page
    // of HTML instead of an error the client can read.
    const res = await ctx.app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('still requires a token for an authenticated API route', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/tasks' })).statusCode).toBe(401);
  });

  it('still serves the API itself', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('without a staticRoot', () => {
  it('keeps the plain JSON 404 for every path', async () => {
    const api = await makeTestApp();
    try {
      const res = await api.app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    } finally {
      await api.close();
    }
  });
});
