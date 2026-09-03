import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getToken, setToken } from '../auth/session';
import { ArchiveScreen } from './ArchiveScreen';
import { NotesScreen } from './NotesScreen';
import { RepeatablesScreen } from './RepeatablesScreen';
import { SettingsScreen } from './SettingsScreen';

afterEach(() => vi.unstubAllGlobals());

type Route = (url: string, init?: RequestInit) => { status?: number; body: unknown } | undefined;

function renderWith(ui: ReactElement, route: Route, onFetch?: (url: string, init?: RequestInit) => void) {
  setToken('t');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      onFetch?.(url, init);
      const hit = route(url, init) ?? { body: {} };
      const status = hit.status ?? 200;
      return { status, ok: status < 400, json: async () => hit.body };
    }) as unknown as typeof fetch,
  );
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  );
}

const SETTINGS = {
  timezone: 'Asia/Tokyo',
  sweepTime: '03:00',
  reminderEnabled: false,
  reminderTime: '08:00',
  webhookKind: null,
  webhookUrl: null,
  updatedAt: '2026-09-01T00:00:00.000Z',
};

// --- Archive ---------------------------------------------------------------

const archivedTask = {
  id: '11111111-1111-4111-8111-111111111111',
  parentId: null,
  rootId: '11111111-1111-4111-8111-111111111111',
  position: 0,
  title: 'Fix the sink',
  notes: null,
  notesUpdatedAt: null,
  priority: 'should' as const,
  categoryId: null,
  dueDate: null,
  createdAt: '2026-08-20T00:00:00.000Z',
  completedAt: '2026-08-31T05:00:00.000Z',
  archivedAt: '2026-09-01T18:00:00.000Z',
  recurrenceId: null,
  occurrenceDate: null,
  workingOnAt: null,
};

describe('ArchiveScreen', () => {
  it('defaults to grouping by parent and shows both dates on a row', async () => {
    renderWith(<ArchiveScreen />, () => ({
      body: {
        groupBy: 'parent',
        groups: [
          {
            rootId: archivedTask.id,
            latestCompletedAt: '2026-08-31T05:00:00.000Z',
            tree: { ...archivedTask, children: [] },
          },
        ],
        nextCursor: null,
      },
    }));

    expect(await screen.findByText('Fix the sink')).toBeInTheDocument();
    expect(screen.getByText(/added 2026-08-20 · done 2026-08-31/)).toBeInTheDocument();
  });

  it('refetches with the chosen grouping', async () => {
    const urls: string[] = [];
    renderWith(
      <ArchiveScreen />,
      (url) =>
        url.includes('groupBy=completed')
          ? { body: { groupBy: 'completed', groups: [{ date: '2026-08-31', tasks: [archivedTask] }], nextCursor: null } }
          : { body: { groupBy: 'parent', groups: [], nextCursor: null } },
      (url) => urls.push(url),
    );

    await userEvent.selectOptions(await screen.findByLabelText(/group by/i), 'completed');

    await waitFor(() => expect(urls.some((u) => u.includes('groupBy=completed'))).toBe(true));
    expect(await screen.findByText('2026-08-31')).toBeInTheDocument();
  });

  it('explains why an empty archive is empty, rather than just saying none', async () => {
    renderWith(<ArchiveScreen />, () => ({ body: { groupBy: 'parent', groups: [], nextCursor: null } }));
    expect(await screen.findByText(/nothing has been filed away yet/i)).toBeInTheDocument();
  });
});

// --- Repeatables -----------------------------------------------------------

const habit = {
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Exercise',
  notes: null,
  priority: 'should' as const,
  categoryId: null,
  scheduleKind: 'weekly' as const,
  daysOfWeek: [1, 3, 5],
  active: true,
  lastProcessedDate: '2026-08-31',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const history = {
  recurrenceId: habit.id,
  entries: [
    { date: '2026-08-26', status: 'completed' as const, completedAt: '2026-08-26T09:00:00.000Z' },
    { date: '2026-08-28', status: 'missed' as const, completedAt: null },
    { date: '2026-08-31', status: 'completed' as const, completedAt: '2026-08-31T09:00:00.000Z' },
  ],
  currentStreak: 1,
  longestStreak: 1,
};

function repeatRoutes(url: string) {
  if (url.includes('/history')) return { body: history };
  if (url.includes('/recurrences')) return { body: [habit] };
  return { body: [] };
}

describe('RepeatablesScreen', () => {
  it('describes a weekly schedule in words', async () => {
    renderWith(<RepeatablesScreen />, repeatRoutes);
    expect(await screen.findByText('Mon, Wed, Fri')).toBeInTheDocument();
  });

  it('shows the streaks', async () => {
    renderWith(<RepeatablesScreen />, repeatRoutes);
    expect(await screen.findByText(/current 1/)).toBeInTheDocument();
    expect(screen.getByText(/longest 1/)).toBeInTheDocument();
  });

  it('labels every history cell for assistive tech, so colour is never the only channel', async () => {
    renderWith(<RepeatablesScreen />, repeatRoutes);
    expect(await screen.findByText('2026-08-28: missed')).toBeInTheDocument();
    expect(screen.getByText('2026-08-26: completed')).toBeInTheDocument();
  });

  it('offers day toggles only once Weekly is chosen', async () => {
    renderWith(<RepeatablesScreen />, repeatRoutes);
    await screen.findByText('Mon, Wed, Fri');

    expect(screen.queryByRole('group', { name: /days/i })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/repeats/i), 'weekly');
    expect(screen.getByRole('group', { name: /days/i })).toBeInTheDocument();
  });

  it("surfaces the API's own message when a weekly habit has no days", async () => {
    renderWith(<RepeatablesScreen />, (url, init) => {
      if (init?.method === 'POST') {
        return {
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'a weekly schedule needs at least one day of the week',
            },
          },
        };
      }
      return repeatRoutes(url);
    });

    await screen.findByText('Mon, Wed, Fri');
    await userEvent.type(screen.getByLabelText(/^habit$/i), 'Gym');
    await userEvent.selectOptions(screen.getByLabelText(/repeats/i), 'weekly');
    await userEvent.click(screen.getByRole('button', { name: /add habit/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one day/i);
  });

  it('pauses a habit through the API', async () => {
    const calls: { url: string; method?: string }[] = [];
    renderWith(<RepeatablesScreen />, repeatRoutes, (url, init) =>
      calls.push({ url, method: init?.method }),
    );

    await userEvent.click(await screen.findByRole('button', { name: /pause/i }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
  });
});

// --- Notes -----------------------------------------------------------------

const note = {
  taskId: '44444444-4444-4444-8444-444444444444',
  title: 'Deploy failed',
  notes: 'broke because of the DNS cache',
  notesUpdatedAt: '2026-08-30T10:00:00.000Z',
  priority: 'should' as const,
  categoryId: null,
  status: 'archived' as const,
  createdAt: '2026-08-20T00:00:00.000Z',
  completedAt: '2026-08-29T00:00:00.000Z',
};

describe('NotesScreen', () => {
  it('lists a note with its task, status and dates', async () => {
    renderWith(<NotesScreen />, () => ({ body: { notes: [note], nextCursor: null } }));

    expect(await screen.findByText('Deploy failed')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByText(/added 2026-08-20/)).toBeInTheDocument();
  });

  it('lets an ARCHIVED note be edited — that is the point of the screen', async () => {
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    renderWith(
      <NotesScreen />,
      () => ({ body: { notes: [note], nextCursor: null } }),
      (url, init) => calls.push({ url, method: init?.method, body: init?.body }),
    );

    const box = await screen.findByLabelText(/note on deploy failed/i);
    expect(box).not.toBeDisabled();
    await userEvent.type(box, ' — fixed by flushing it');
    await userEvent.tab();

    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
  });

  it('does not save when the text was not changed, so the order does not shift', async () => {
    const calls: { method?: string }[] = [];
    renderWith(
      <NotesScreen />,
      () => ({ body: { notes: [note], nextCursor: null } }),
      (_url, init) => calls.push({ method: init?.method }),
    );

    const box = await screen.findByLabelText(/note on deploy failed/i);
    await userEvent.click(box);
    await userEvent.tab();

    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('searches through the API', async () => {
    const urls: string[] = [];
    renderWith(
      <NotesScreen />,
      () => ({ body: { notes: [], nextCursor: null } }),
      (url) => urls.push(url),
    );

    await userEvent.type(await screen.findByLabelText(/search notes/i), 'dns');

    await waitFor(() => expect(urls.some((u) => u.includes('q=dns'))).toBe(true));
  });

  it('invites action when there are no notes', async () => {
    renderWith(<NotesScreen />, () => ({ body: { notes: [], nextCursor: null } }));
    expect(await screen.findByText(/notes you attach to tasks will collect here/i)).toBeInTheDocument();
  });
});

// --- Settings --------------------------------------------------------------

function settingsRoutes(url: string) {
  if (url.includes('/categories')) return { body: [] };
  return { body: SETTINGS };
}

describe('SettingsScreen', () => {
  it('shows the four sections', async () => {
    renderWith(<SettingsScreen onSignedOut={() => {}} />, settingsRoutes);
    for (const name of [/schedule/i, /daily reminder/i, /categories/i, /password/i]) {
      expect(await screen.findByRole('group', { name })).toBeInTheDocument();
    }
  });

  it("surfaces the API's message when the reminder is enabled with no webhook", async () => {
    renderWith(<SettingsScreen onSignedOut={() => {}} />, (url, init) => {
      if (init?.method === 'PUT') {
        return {
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'a webhook kind and url are required to enable the daily reminder',
            },
          },
        };
      }
      return settingsRoutes(url);
    });

    await userEvent.click(await screen.findByLabelText(/send it/i));

    expect(await screen.findByRole('alert')).toHaveTextContent(/webhook/i);
  });

  it('reports a failed test delivery as a failure, not a success', async () => {
    renderWith(<SettingsScreen onSignedOut={() => {}} />, (url, init) => {
      if (url.includes('/webhook/test') && init?.method === 'POST') {
        return { body: { delivered: false } };
      }
      return settingsRoutes(url);
    });

    await userEvent.click(await screen.findByRole('button', { name: /send a test message/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/could not deliver/i);
  });

  it('reports a successful test delivery', async () => {
    renderWith(<SettingsScreen onSignedOut={() => {}} />, (url, init) => {
      if (url.includes('/webhook/test') && init?.method === 'POST') return { body: { delivered: true } };
      return settingsRoutes(url);
    });

    await userEvent.click(await screen.findByRole('button', { name: /send a test message/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/sent/i);
  });

  it('signs out after a password change, because the API retires every token', async () => {
    const onSignedOut = vi.fn();
    renderWith(<SettingsScreen onSignedOut={onSignedOut} />, (url, init) => {
      if (url.includes('/auth/password') && init?.method === 'POST') return { status: 204, body: null };
      return settingsRoutes(url);
    });

    await userEvent.type(await screen.findByLabelText(/current password/i), 'admin');
    await userEvent.type(screen.getByLabelText(/new password/i), 'a-longer-password');
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
    expect(getToken()).toBeNull();
  });

  it("shows the API's message for a too-short password", async () => {
    renderWith(<SettingsScreen onSignedOut={() => {}} />, (url, init) => {
      if (url.includes('/auth/password') && init?.method === 'POST') {
        return {
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'new password must be at least 8 characters',
            },
          },
        };
      }
      return settingsRoutes(url);
    });

    await userEvent.type(await screen.findByLabelText(/current password/i), 'admin');
    await userEvent.type(screen.getByLabelText(/new password/i), 'short');
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/i);
  });
});
