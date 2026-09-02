import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, apiFetch } from './client';
import { clearToken, getToken, setToken } from '../auth/session';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function initOf(fetchMock: typeof fetch): RequestInit {
  return (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
}

beforeEach(() => clearToken());
afterEach(() => vi.unstubAllGlobals());

describe('apiFetch', () => {
  it('prefixes /api and returns the parsed body', async () => {
    const fetchMock = mockFetch(200, { status: 'ok' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/health')).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything());
  });

  it('sends the bearer token when one is stored', async () => {
    setToken('t0ken');
    const fetchMock = mockFetch(200, {});
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/tasks');

    expect((initOf(fetchMock).headers as Record<string, string>).authorization).toBe('Bearer t0ken');
  });

  it('sends no authorization header when there is no token', async () => {
    const fetchMock = mockFetch(200, {});
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/health');

    expect((initOf(fetchMock).headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('sets a JSON content type only when there is a body', async () => {
    const withBody = mockFetch(200, {});
    vi.stubGlobal('fetch', withBody);
    await apiFetch('/tasks', { method: 'POST', body: '{}' });
    expect((initOf(withBody).headers as Record<string, string>)['content-type']).toContain('application/json');

    vi.unstubAllGlobals();
    const withoutBody = mockFetch(200, {});
    vi.stubGlobal('fetch', withoutBody);
    await apiFetch('/tasks');
    expect((initOf(withoutBody).headers as Record<string, string>)['content-type']).toBeUndefined();
  });

  it('throws ApiError carrying the envelope code and status', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(409, { error: { code: 'CONFLICT', message: 'that move would create a cycle' } }),
    );

    await expect(apiFetch('/tasks/x/move')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: 'that move would create a cycle',
    });
  });

  it('clears the stored token on 401, so a stale session cannot loop', async () => {
    setToken('stale');
    vi.stubGlobal(
      'fetch',
      mockFetch(401, { error: { code: 'UNAUTHENTICATED', message: 'invalid or expired token' } }),
    );

    await expect(apiFetch('/tasks')).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toBeNull();
  });

  it('survives an error body that is not the envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 502,
        ok: false,
        json: async () => {
          throw new Error('not json');
        },
      })) as unknown as typeof fetch,
    );

    await expect(apiFetch('/tasks')).rejects.toMatchObject({ code: 'INTERNAL', status: 502 });
  });

  it('returns undefined for 204, rather than trying to parse a body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 204,
        ok: true,
        json: async () => {
          throw new Error('no body');
        },
      })) as unknown as typeof fetch,
    );

    await expect(apiFetch('/tasks/x')).resolves.toBeUndefined();
  });

  it('validates against a schema when given one', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { wrong: true }));
    await expect(apiFetch('/settings', undefined, z.object({ timezone: z.string() }))).rejects.toThrow();
  });
});
