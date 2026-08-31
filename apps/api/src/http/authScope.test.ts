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
 *
 * When a resource route (e.g. `/api/tasks`) has its own registered handler *and* a
 * nested parametric child (e.g. `/api/tasks/:id`), find-my-way's tree printer starts
 * a fresh subtree at the parent leaf: the child line only carries its own remaining
 * segment ("/:id"), not the accumulated ancestor path. Each line's indentation depth
 * (groups of 4 leading columns, "│   " or "    ") says how many ancestor segments to
 * prepend, so the walk below rebuilds full paths from that depth instead of trusting
 * each line to already be absolute.
 */
function listRoutes(app: FastifyInstance): Route[] {
  const tree = app.printRoutes({ commonPrefix: false });
  const routes: Route[] = [];
  const pathAtDepth: string[] = [];
  for (const line of tree.split('\n')) {
    const lineMatch = /^((?:[│ ] {3})*)(?:├── |└── )(\S+)\s+\(([^)]+)\)\s*$/.exec(line);
    if (!lineMatch) continue;
    const [, indent, segment, methods] = lineMatch;
    const depth = indent.length / 4;
    const path = (depth > 0 ? pathAtDepth[depth - 1] : '') + segment;
    pathAtDepth[depth] = path;

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
