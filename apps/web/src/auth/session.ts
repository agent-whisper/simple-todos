const KEY = 'simple-todos.token';

/**
 * The bearer token, kept in localStorage so a reload does not sign you out.
 *
 * Every accessor is wrapped: a private-mode browser can throw on access rather
 * than returning null, and an exception here would take down the whole app for
 * no better reason than "storage is unavailable".
 */
export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // The session simply lasts only as long as this page.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
