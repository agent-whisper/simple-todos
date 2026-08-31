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
 *
 * KNOWN LIMITATION — wildcard routes. find-my-way stores wildcards in a separate
 * branch, so with `commonPrefix: false` a route registered as `/api/foo/*` prints
 * as a top-level `* (GET, HEAD)` with its prefix discarded entirely. Its real path
 * is therefore NOT recoverable from this output. Verified directly against
 * fastify 5 / find-my-way 9 — this is not a parsing bug that can be fixed here.
 *
 * The consequence is a loud false positive rather than a silent hole: the bogus
 * path matches no route, the unauthenticated injection below gets 404 instead of
 * 401, and the route is reported as unexpectedly open, failing this test. That is
 * the safe direction, but it means this guard cannot actually verify that a
 * wildcard route is protected.
 *
 * No wildcard route exists today. Plan 3 registers one via `@fastify/static` to
 * serve the SPA, and MUST replace this `printRoutes` parsing with a real route
 * table — most plausibly by having `buildApp` accept an optional `onRoute`
 * observer, since a hook added after `register()` boots is too late to see them.
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
    const parent = depth > 0 ? (pathAtDepth[depth - 1] ?? '') : '';
    // Segments normally begin with '/'. A wildcard does not, so this keeps the
    // reconstructed path a well-formed URL — see the KNOWN LIMITATION above.
    const needsSlash = segment !== '' && !segment.startsWith('/') && !parent.endsWith('/');
    const path = parent + (needsSlash ? '/' : '') + segment;
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
