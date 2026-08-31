import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer } from './server.js';

let dir: string;
let stop: (() => Promise<void>) | null = null;

// These tests only ever exercise the app through inject(), never a bound
// socket, so the port value is irrelevant to what they prove. Use a real
// port rather than '0' — the config validator requires a positive PORT,
// since PORT=0 (an arbitrary ephemeral port) would silently defeat the
// point of a self-hosted app reachable at a known address.
const env = () => ({
  PORT: '3100',
  DATA_DIR: dir,
  AUTH_USERNAME: 'tester',
  AUTH_PASSWORD: 'correct-horse-battery-staple',
  JWT_SECRET: 'test-secret-that-is-long-enough-for-hs256',
  DEFAULT_TZ: 'Asia/Tokyo',
  LOG_LEVEL: 'silent',
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'simple-todos-server-'));
});

afterEach(async () => {
  if (stop) await stop();
  stop = null;
  rmSync(dir, { recursive: true, force: true });
});

describe('startServer', () => {
  it('migrates and serves health', async () => {
    const started = await startServer(env());
    stop = started.stop;

    const res = await started.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
  });

  it('seeds the user from the environment so login works on a fresh volume', async () => {
    const started = await startServer(env());
    stop = started.stop;

    const res = await started.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'tester', password: 'correct-horse-battery-staple' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('keeps data across a restart of the same volume', async () => {
    const first = await startServer(env());
    const login = await first.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'tester', password: 'correct-horse-battery-staple' },
    });
    const { token } = login.json() as { token: string };
    await first.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Survives a restart' },
    });
    await first.stop();

    const second = await startServer(env());
    stop = second.stop;

    const relogin = await second.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'tester', password: 'correct-horse-battery-staple' },
    });
    const listed = await second.app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${(relogin.json() as { token: string }).token}` },
    });
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0].title).toBe('Survives a restart');
  });

  it('refuses to start when a required variable is missing', async () => {
    const { JWT_SECRET, ...incomplete } = env();
    await expect(startServer(incomplete)).rejects.toThrow();
  });

  it('refuses a JWT_SECRET that is too short to be worth having', async () => {
    await expect(startServer({ ...env(), JWT_SECRET: 'short' })).rejects.toThrow();
  });

  it('closes the database handle when migration fails, so a half-upgraded volume can still be cleaned up', async () => {
    // Poison the database file before startup so runMigrations() throws.
    // On Windows, an unreleased SQLite handle makes rmSync() throw EBUSY,
    // so the cleanup below is a real proof that the handle was closed,
    // not just that startServer() rejected.
    writeFileSync(join(dir, 'todos.db'), 'not a sqlite database');

    await expect(startServer(env())).rejects.toThrow();

    expect(() => rmSync(dir, { recursive: true, force: false })).not.toThrow();
  });
});
