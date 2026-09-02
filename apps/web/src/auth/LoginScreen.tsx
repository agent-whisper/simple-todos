import { LoginResponse } from '@simple-todos/shared';
import { useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '../api/client';
import { setToken } from './session';

export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch(
        '/auth/login',
        { method: 'POST', body: JSON.stringify({ username, password }) },
        LoginResponse,
      );
      setToken(res.token);
      onSignedIn();
    } catch (err) {
      // The API deliberately returns the same error for a wrong password and an
      // unknown username; saying more here would undo that.
      setError(
        err instanceof ApiError && err.code === 'RATE_LIMITED'
          ? 'Too many attempts. Wait a minute and try again.'
          : 'Those credentials were not accepted.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <h1 className="login__mark">simple todos</h1>
      <p className="login__sub">Your list, on your own server.</p>

      <form onSubmit={submit} className="login__form">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        {error && (
          <p role="alert" className="login__error">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
