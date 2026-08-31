import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const VALID_ENV = {
  PORT: '4000',
  DATA_DIR: '/srv/data',
  AUTH_USERNAME: 'admin',
  AUTH_PASSWORD: 'super-secret-password',
  JWT_SECRET: 'a'.repeat(32),
  DEFAULT_TZ: 'Asia/Tokyo',
  LOG_LEVEL: 'debug',
} satisfies NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('parses a complete, valid environment into every field with the right types', () => {
    const config = loadConfig(VALID_ENV);

    expect(config).toEqual({
      port: 4000,
      dataDir: '/srv/data',
      authUsername: 'admin',
      authPassword: 'super-secret-password',
      jwtSecret: 'a'.repeat(32),
      defaultTz: 'Asia/Tokyo',
      logLevel: 'debug',
    });
    expect(typeof config.port).toBe('number');
  });

  it('coerces PORT from a string to a number', () => {
    const config = loadConfig({ ...VALID_ENV, PORT: '8080' });
    expect(config.port).toBe(8080);
    expect(typeof config.port).toBe('number');
  });

  it('defaults PORT to 3000 when omitted', () => {
    const { PORT: _PORT, ...rest } = VALID_ENV;
    const config = loadConfig(rest);
    expect(config.port).toBe(3000);
  });

  it('defaults DEFAULT_TZ to Asia/Tokyo when absent', () => {
    const { DEFAULT_TZ: _DEFAULT_TZ, ...rest } = VALID_ENV;
    const config = loadConfig(rest);
    expect(config.defaultTz).toBe('Asia/Tokyo');
  });

  it('defaults LOG_LEVEL to info when absent', () => {
    const { LOG_LEVEL: _LOG_LEVEL, ...rest } = VALID_ENV;
    const config = loadConfig(rest);
    expect(config.logLevel).toBe('info');
  });

  it('throws when AUTH_USERNAME is missing', () => {
    const { AUTH_USERNAME: _AUTH_USERNAME, ...rest } = VALID_ENV;
    expect(() => loadConfig(rest)).toThrow();
  });

  it('throws when AUTH_PASSWORD is missing', () => {
    const { AUTH_PASSWORD: _AUTH_PASSWORD, ...rest } = VALID_ENV;
    expect(() => loadConfig(rest)).toThrow();
  });

  it('throws when JWT_SECRET is missing', () => {
    const { JWT_SECRET: _JWT_SECRET, ...rest } = VALID_ENV;
    expect(() => loadConfig(rest)).toThrow();
  });

  it('throws when JWT_SECRET is exactly 31 characters', () => {
    expect(() => loadConfig({ ...VALID_ENV, JWT_SECRET: 'a'.repeat(31) })).toThrow();
  });

  it('accepts a JWT_SECRET of exactly 32 characters', () => {
    const config = loadConfig({ ...VALID_ENV, JWT_SECRET: 'b'.repeat(32) });
    expect(config.jwtSecret).toBe('b'.repeat(32));
  });

  it('throws when PORT is not numeric', () => {
    expect(() => loadConfig({ ...VALID_ENV, PORT: 'not-a-number' })).toThrow();
  });

  it('throws when PORT is negative', () => {
    expect(() => loadConfig({ ...VALID_ENV, PORT: '-1' })).toThrow();
  });

  it('never leaks the rejected JWT_SECRET or AUTH_PASSWORD value in a thrown error message', () => {
    const rejectedJwtSecret = 'THE-REJECTED-SHORT-SECRET-VALUE';
    const rejectedAuthPassword = 'THE-REJECTED-EMPTY-MARKER-VALUE';

    const attempts: Array<{ env: NodeJS.ProcessEnv; secretValues: string[] }> = [
      // JWT_SECRET too short (31 chars) — value itself must not appear in the message.
      {
        env: { ...VALID_ENV, JWT_SECRET: rejectedJwtSecret.slice(0, 31) },
        secretValues: [rejectedJwtSecret.slice(0, 31), VALID_ENV.AUTH_PASSWORD],
      },
      // AUTH_PASSWORD missing/empty — the valid JWT_SECRET carried along must not leak either.
      {
        env: { ...VALID_ENV, AUTH_PASSWORD: '' },
        secretValues: [VALID_ENV.JWT_SECRET],
      },
      // Non-numeric PORT alongside real secrets — an unrelated failure must still not echo them.
      {
        env: { ...VALID_ENV, JWT_SECRET: rejectedJwtSecret, AUTH_PASSWORD: rejectedAuthPassword, PORT: 'garbage' },
        secretValues: [rejectedJwtSecret, rejectedAuthPassword],
      },
    ];

    for (const { env, secretValues } of attempts) {
      try {
        loadConfig(env);
        throw new Error('expected loadConfig to throw');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        for (const value of secretValues) {
          expect(message).not.toContain(value);
        }
      }
    }
  });
});
