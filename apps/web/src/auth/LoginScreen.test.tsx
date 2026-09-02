import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginScreen } from './LoginScreen';
import { clearToken, getToken } from './session';

beforeEach(() => clearToken());
afterEach(() => vi.unstubAllGlobals());

function stub(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ status, ok: status < 400, json: async () => body })) as unknown as typeof fetch,
  );
}

async function signIn(password: string) {
  await userEvent.type(screen.getByLabelText(/username/i), 'admin');
  await userEvent.type(screen.getByLabelText(/password/i), password);
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('LoginScreen', () => {
  it('labels both fields', () => {
    render(<LoginScreen onSignedIn={() => {}} />);
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('stores the token and reports success', async () => {
    stub(200, { token: 'abc', expiresAt: '2026-12-01T00:00:00.000Z' });
    const onSignedIn = vi.fn();
    render(<LoginScreen onSignedIn={onSignedIn} />);

    await signIn('admin');

    expect(getToken()).toBe('abc');
    expect(onSignedIn).toHaveBeenCalled();
  });

  it('shows the failure without saying which half was wrong', async () => {
    stub(401, { error: { code: 'UNAUTHENTICATED', message: 'invalid credentials' } });
    render(<LoginScreen onSignedIn={() => {}} />);

    await signIn('wrong');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/credentials/i);
    // The API refuses to say which half failed; the UI must not undo that.
    expect(alert.textContent).not.toMatch(/username|password/i);
    expect(getToken()).toBeNull();
  });

  it('tells the user plainly when they are being rate limited', async () => {
    stub(429, { error: { code: 'RATE_LIMITED', message: 'too many requests' } });
    render(<LoginScreen onSignedIn={() => {}} />);

    await signIn('admin');

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('disables the button while the request is in flight', async () => {
    let release: (v: unknown) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((r) => { release = r; })) as unknown as typeof fetch,
    );
    render(<LoginScreen onSignedIn={() => {}} />);

    await signIn('admin');

    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
    release({ status: 200, ok: true, json: async () => ({ token: 'x', expiresAt: '2026-12-01T00:00:00.000Z' }) });
  });
});
