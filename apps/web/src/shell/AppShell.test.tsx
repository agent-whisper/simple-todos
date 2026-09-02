import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import { getToken, setToken } from '../auth/session';

afterEach(() => vi.unstubAllGlobals());

function renderShell(onSignedOut = () => {}) {
  setToken('t');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.includes('/settings')
        ? {
            timezone: 'Asia/Tokyo',
            sweepTime: '03:00',
            reminderEnabled: false,
            reminderTime: '08:00',
            webhookKind: null,
            webhookUrl: null,
            updatedAt: '2026-09-01T00:00:00.000Z',
          }
        : { username: 'admin', timezone: 'Asia/Tokyo' };
      return { status: 200, ok: true, json: async () => body };
    }) as unknown as typeof fetch,
  );

  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell onSignedOut={onSignedOut} />}>
            <Route path="/" element={<p>active screen</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppShell', () => {
  it('renders all five destinations', async () => {
    renderShell();
    for (const name of [/active/i, /archive/i, /repeating/i, /notes/i, /settings/i]) {
      expect(await screen.findByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('renders the child route', async () => {
    renderShell();
    expect(await screen.findByText('active screen')).toBeInTheDocument();
  });

  it('shows the sweep countdown once settings load', async () => {
    renderShell();
    expect(await screen.findByText(/filing away in/i)).toBeInTheDocument();
  });

  it('marks the current destination for assistive tech', async () => {
    renderShell();
    expect(await screen.findByRole('link', { name: /active/i })).toHaveAttribute('aria-current', 'page');
  });

  it('signs out, clearing the token', async () => {
    const onSignedOut = vi.fn();
    renderShell(onSignedOut);

    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }));

    expect(getToken()).toBeNull();
    expect(onSignedOut).toHaveBeenCalled();
  });

  it('shows today date in the spine', async () => {
    renderShell();
    // The day number is rendered from the user's configured zone, so assert the
    // month/weekday band exists rather than pinning a number the clock decides.
    expect(await screen.findByTestId('spine-date')).toBeInTheDocument();
  });
});
