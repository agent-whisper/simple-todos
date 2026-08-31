import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, TEST_PASSWORD, TEST_USERNAME, type TestApp } from '../../test/helpers/testApp.js';
import { AuthService } from './authService.js';

let ctx: TestApp;
let auth: AuthService;

beforeEach(async () => {
  ctx = await makeTestApp();
  auth = new AuthService(ctx.db, ctx.clock, ctx.config);
  await auth.seedIfMissing();
});

afterEach(async () => {
  await ctx.close();
});

describe('seedIfMissing', () => {
  it('creates the single user and the settings row on first boot', () => {
    const user = ctx.db.$client.prepare('SELECT username, token_version FROM user').get() as {
      username: string;
      token_version: number;
    };
    expect(user.username).toBe(TEST_USERNAME);
    expect(user.token_version).toBe(1);

    const settings = ctx.db.$client.prepare('SELECT timezone FROM settings').get() as { timezone: string };
    expect(settings.timezone).toBe('Asia/Tokyo');
  });

  it('does not overwrite an existing user, so a redeploy never resets the password', async () => {
    await auth.changePassword(TEST_PASSWORD, 'a-new-password-entirely');
    await auth.seedIfMissing();
    await expect(auth.login(TEST_USERNAME, 'a-new-password-entirely')).resolves.toBeDefined();
    await expect(auth.login(TEST_USERNAME, TEST_PASSWORD)).rejects.toThrow();
  });

  it('stores the password hashed, not in the clear', () => {
    const row = ctx.db.$client.prepare('SELECT password_hash FROM user').get() as { password_hash: string };
    expect(row.password_hash).not.toContain(TEST_PASSWORD);
    expect(row.password_hash.startsWith('$argon2')).toBe(true);
  });
});

describe('login', () => {
  it('issues a token for correct credentials', async () => {
    const { token, expiresAt } = await auth.login(TEST_USERNAME, TEST_PASSWORD);
    expect(token.split('.')).toHaveLength(3);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(ctx.clock.now().getTime());
  });

  it('rejects a wrong password and an unknown username alike', async () => {
    await expect(auth.login(TEST_USERNAME, 'wrong')).rejects.toThrow(/invalid credentials/i);
    await expect(auth.login('nobody', TEST_PASSWORD)).rejects.toThrow(/invalid credentials/i);
  });
});

describe('verify', () => {
  it('accepts a token it just issued', async () => {
    const { token } = await auth.login(TEST_USERNAME, TEST_PASSWORD);
    await expect(auth.verify(token)).resolves.toEqual({ userId: 1 });
  });

  it('rejects a garbage token', async () => {
    await expect(auth.verify('not.a.token')).rejects.toThrow();
  });

  it('rejects a token issued before a password change', async () => {
    const { token } = await auth.login(TEST_USERNAME, TEST_PASSWORD);
    await auth.changePassword(TEST_PASSWORD, 'a-new-password-entirely');
    await expect(auth.verify(token)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const { token } = await auth.login(TEST_USERNAME, TEST_PASSWORD);
    ctx.clock.set('2027-01-01T00:00:00Z'); // beyond the 90-day window
    await expect(auth.verify(token)).rejects.toThrow();
  });
});

describe('changePassword', () => {
  it('refuses when the current password is wrong', async () => {
    await expect(auth.changePassword('wrong', 'another-password-here')).rejects.toThrow(/invalid credentials/i);
  });
});
