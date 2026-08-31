import type { FastifyInstance, HTTPMethods } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await makeTestApp();
});

afterEach(async () => {
  await ctx.close();
});

/**
 * The only routes that must be reachable without a bearer token. Anything else registered
 * under /api — now or in a later task — is expected to sit inside the authenticated scope
 * in app.ts and therefore reject an unauthenticated request with 401.
 */
const EXPECTED_OPEN_ROUTES = new Set(['GET /api/health', 'POST /api/auth/login']);

interface Route {
  method: HTTPMethods;
  path: string;
}

/**
 * Fastify doesn't expose a route table directly; `printRoutes` renders one line per
 * path with its methods in parentheses, e.g. "├── /api/auth/me (GET, HEAD)".
 */
function listRoutes(app: FastifyInstance): Route[] {
  const tree = app.printRoutes({ commonPrefix: false });
  const routes: Route[] = [];
  for (const line of tree.split('\n')) {
    const match = /(\S+)\s+\(([^)]+)\)\s*$/.exec(line);
    if (!match) continue;
    const [, path, methods] = match;
    for (const method of methods.split(',').map((m) => m.trim())) {
      // HEAD is Fastify's automatic shadow of GET on the same route/hook chain; checking
      // GET already exercises the same auth path.
      if (method === 'HEAD') continue;
      routes.push({ method: method as HTTPMethods, path });
    }
  }
  return routes;
}

describe('the authenticated route scope', () => {
  it('leaves open exactly {GET /api/health, POST /api/auth/login}; every other route demands a bearer token', async () => {
    const routes = listRoutes(ctx.app);
    // Sanity check: if route discovery ever comes back empty, the assertion below would
    // pass vacuously and hide a real regression.
    expect(routes.length).toBeGreaterThan(EXPECTED_OPEN_ROUTES.size);

    const actuallyOpen = new Set<string>();
    for (const { method, path } of routes) {
      const res = await ctx.app.inject({ method, url: path });
      const key = `${method} ${path}`;
      if (res.statusCode !== 401) {
        actuallyOpen.add(key);
      } else if (EXPECTED_OPEN_ROUTES.has(key)) {
        throw new Error(`${key} is supposed to be open but was rejected with 401`);
      }
    }

    // Equality (not "is a subset of") so a newly-opened route fails this test loudly,
    // naming the offending route in the diff, until the allowlist above is updated on purpose.
    expect(actuallyOpen).toEqual(EXPECTED_OPEN_ROUTES);
  });
});
