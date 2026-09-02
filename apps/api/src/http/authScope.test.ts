import type { HTTPMethods } from 'fastify';
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
 * Route discovery via Fastify's own `onRoute` hook, not by parsing `printRoutes`.
 *
 * The previous version rebuilt paths from the printed tree's indentation, which
 * cannot represent a wildcard: find-my-way stores wildcards in a separate branch
 * and prints `/api/foo/*` as a bare top-level `*` with its prefix discarded. That
 * made this guard unable to verify a wildcard route was protected — and
 * `@fastify/static` registers exactly such a route to serve the SPA.
 *
 * The hook has to be installed before any plugin registers, which is why
 * `buildApp` accepts an `onRoute` observer: a hook added after `await
 * app.register(...)` is too late, because that boots the plugin immediately.
 */
async function discoverRoutes(): Promise<Route[]> {
  const routes: Route[] = [];
  const probe = await makeTestApp(undefined, {
    onRoute: ({ method, url }) => {
      // HEAD is Fastify's automatic shadow of GET on the same hook chain;
      // checking GET already exercises the same auth path.
      if (method !== 'HEAD') routes.push({ method: method as HTTPMethods, path: url });
    },
  });
  await probe.close();
  return routes;
}

describe('the authenticated route scope', () => {
  it('leaves open exactly {GET /api/health, POST /api/auth/login}; every other route demands a bearer token', async () => {
    const routes = await discoverRoutes();
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
