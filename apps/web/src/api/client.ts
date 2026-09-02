import type { ErrorCodeValue } from '@simple-todos/shared';
import type { ZodType } from 'zod';
import { clearToken, getToken } from '../auth/session';

export class ApiError extends Error {
  readonly code: ErrorCodeValue;
  readonly status: number;

  constructor(code: ErrorCodeValue, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Every call the app makes. Adds the bearer token, unwraps the error envelope
 * into an ApiError the UI can branch on, and optionally validates the response
 * against the same shared schema the API validated it with.
 */
export async function apiFetch<T>(path: string, init?: RequestInit, schema?: ZodType<T>): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(init?.body ? { 'content-type': 'application/json' } : {}),
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`/api${path}`, { ...init, headers });

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    // A 401 means the token is missing, stale, or retired by a password change.
    // Drop it so the app returns to login rather than retrying forever with a
    // credential that cannot work.
    if (res.status === 401) clearToken();

    let code: ErrorCodeValue = 'INTERNAL';
    let message = `request failed with ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: ErrorCodeValue; message?: string } };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Not the envelope — a proxy error page, say. Keep the defaults.
    }
    throw new ApiError(code, message, res.status);
  }

  const body = (await res.json()) as unknown;
  return schema ? schema.parse(body) : (body as T);
}
