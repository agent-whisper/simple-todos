import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, TEST_PASSWORD, TEST_USERNAME, type TestApp } from '../../../test/helpers/testApp.js';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await makeTestApp();
});

afterEach(async () => {
  await ctx.close();
});

async function login(password = TEST_PASSWORD) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: TEST_USERNAME, password },
  });
}

describe('POST /api/auth/login', () => {
  it('returns a token for correct credentials', async () => {
    const res = await login();
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().token).toBe('string');
  });

  it('returns 401 for a wrong password', async () => {
    const res = await login('wrong');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 400 when the body is malformed', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/auth/me', () => {
  it('requires a token', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a malformed Authorization header', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Basic abc' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns the username and timezone with a valid token', async () => {
    const { token } = (await login()).json();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ username: TEST_USERNAME, timezone: 'Asia/Tokyo' });
  });
});

describe('POST /api/auth/password', () => {
  it('changes the password and invalidates existing tokens', async () => {
    const { token } = (await login()).json();

    const changed = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: TEST_PASSWORD, newPassword: 'a-new-password-entirely' },
    });
    expect(changed.statusCode).toBe(204);

    const reused = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(reused.statusCode).toBe(401);

    expect((await login('a-new-password-entirely')).statusCode).toBe(200);
  });

  it('rejects a new password shorter than eight characters', async () => {
    const { token } = (await login()).json();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: TEST_PASSWORD, newPassword: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });
});
