import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { FixedClock } from '../../src/clock.js';
import type { Config } from '../../src/config.js';
import { openDb, runMigrations, type AppDb } from '../../src/db/index.js';
import { buildApp } from '../../src/http/app.js';
import { makeTempDbFile, removeTempDb } from './tempDb.js';

export const TEST_USERNAME = 'tester';
export const TEST_PASSWORD = 'correct-horse-battery-staple';

export interface TestApp {
  app: FastifyInstance;
  db: AppDb;
  clock: FixedClock;
  config: Config;
  close(): Promise<void>;
}

/**
 * A real app over a real, throwaway database with migrations applied, so every
 * integration test exercises the migration path too.
 *
 * Note: deliberately does NOT call `app.ready()` here. Fastify refuses to
 * register routes on an already-booted instance, and the error-handler test
 * (and others) register extra routes on the app returned by this helper
 * before making their first request. `app.inject()` readies the instance
 * implicitly on first call, so this is sufficient.
 */
export async function makeTestApp(at = '2026-08-31T00:00:00Z'): Promise<TestApp> {
  const file = makeTempDbFile();
  const db = openDb(file);
  runMigrations(db);

  const clock = new FixedClock(at);
  const config: Config = {
    port: 0,
    dataDir: '.',
    authUsername: TEST_USERNAME,
    authPassword: TEST_PASSWORD,
    jwtSecret: 'test-secret-that-is-long-enough-for-hs256',
    defaultTz: 'Asia/Tokyo',
    logLevel: 'silent',
    trustProxy: false,
  };

  const app = await buildApp({ db, clock, config });

  return {
    app,
    db,
    clock,
    config,
    async close() {
      await app.close();
      db.$client.close();
      removeTempDb(file);
    },
  };
}

export interface AuthedApp extends TestApp {
  token: string;
  get(url: string): Promise<LightMyRequestResponse>;
  post(url: string, payload?: unknown): Promise<LightMyRequestResponse>;
  patch(url: string, payload?: unknown): Promise<LightMyRequestResponse>;
  del(url: string): Promise<LightMyRequestResponse>;
  /** For verbs the four shorthands do not cover, such as PUT. */
  request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse>;
}

/** A test app with a logged-in client, since almost every route needs one. */
export async function makeAuthedApp(at = '2026-08-31T00:00:00Z'): Promise<AuthedApp> {
  const ctx = await makeTestApp(at);

  const login = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: TEST_USERNAME, password: TEST_PASSWORD },
  });
  const { token } = login.json() as { token: string };
  const headers = { authorization: `Bearer ${token}` };

  return {
    ...ctx,
    token,
    get: (url) => ctx.app.inject({ method: 'GET', url, headers }),
    post: (url, payload) => ctx.app.inject({ method: 'POST', url, headers, payload: payload as never }),
    patch: (url, payload) => ctx.app.inject({ method: 'PATCH', url, headers, payload: payload as never }),
    del: (url) => ctx.app.inject({ method: 'DELETE', url, headers }),
    request: (method, url, payload) =>
      ctx.app.inject({
        method,
        url,
        headers,
        ...(payload === undefined ? {} : { payload: payload as object }),
      }),
  };
}
