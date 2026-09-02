import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveScreen } from './ActiveScreen';
import { setToken } from '../auth/session';

const tree = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    parentId: null,
    rootId: '11111111-1111-4111-8111-111111111111',
    position: 0,
    title: 'Plan Kyoto trip',
    notes: null,
    notesUpdatedAt: null,
    priority: 'must',
    categoryId: null,
    dueDate: '2026-09-20',
    createdAt: '2026-09-01T00:00:00.000Z',
    completedAt: null,
    archivedAt: null,
    recurrenceId: null,
    occurrenceDate: null,
    children: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        parentId: '11111111-1111-4111-8111-111111111111',
        rootId: '11111111-1111-4111-8111-111111111111',
        position: 0,
        title: 'Book flights',
        notes: 'ANA is cheaper midweek',
        notesUpdatedAt: '2026-09-01T00:00:00.000Z',
        priority: 'should',
        categoryId: null,
        dueDate: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        completedAt: '2026-09-01T05:00:00.000Z',
        archivedAt: null,
        recurrenceId: null,
        occurrenceDate: null,
        children: [],
      },
    ],
  },
];

afterEach(() => vi.unstubAllGlobals());

function renderScreen(
  opts: { tasks?: unknown; onFetch?: (url: string, init?: RequestInit) => void } = {},
) {
  setToken('t');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      opts.onFetch?.(url, init);
      if (url.includes('/categories')) return { status: 200, ok: true, json: async () => [] };
      return { status: 200, ok: true, json: async () => opts.tasks ?? tree };
    }) as unknown as typeof fetch,
  );

  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ActiveScreen />
    </QueryClientProvider>,
  );
}

describe('ActiveScreen', () => {
  it('renders the tree with nesting preserved', async () => {
    renderScreen();
    expect(await screen.findByText('Plan Kyoto trip')).toBeInTheDocument();
    expect(screen.getByText('Book flights')).toBeInTheDocument();
  });

  it('shows a completed-but-unswept task as done without hiding it', async () => {
    renderScreen();
    const done = await screen.findByRole('checkbox', { name: /book flights/i });
    expect(done).toBeChecked();
    // It stays on screen until the sweep — that is the whole point of the
    // two-timestamp model.
    expect(screen.getByText('Book flights')).toBeInTheDocument();
  });

  it('labels the priority in text, not only by the rule weight', async () => {
    renderScreen();
    // The rule weight is the visual encoding; the label is what makes it
    // accessible to anyone who cannot see a 3px border.
    expect(await screen.findByText('Must')).toBeInTheDocument();
    expect(screen.getByText('Should')).toBeInTheDocument();
  });

  it('shows the deadline when there is one', async () => {
    renderScreen();
    expect(await screen.findByText(/2026-09-20/)).toBeInTheDocument();
  });

  it('completes a task through the API when its box is ticked', async () => {
    const calls: { url: string; method?: string }[] = [];
    renderScreen({ onFetch: (url, init) => calls.push({ url, method: init?.method }) });

    await userEvent.click(await screen.findByRole('checkbox', { name: /plan kyoto trip/i }));

    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/complete') && c.method === 'POST')).toBe(true),
    );
  });

  it('unticks through the uncomplete endpoint', async () => {
    const calls: { url: string; method?: string }[] = [];
    renderScreen({ onFetch: (url, init) => calls.push({ url, method: init?.method }) });

    await userEvent.click(await screen.findByRole('checkbox', { name: /book flights/i }));

    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/uncomplete') && c.method === 'POST')).toBe(true),
    );
  });

  it('adds a task', async () => {
    const calls: { url: string; method?: string }[] = [];
    renderScreen({ onFetch: (url, init) => calls.push({ url, method: init?.method }) });

    await userEvent.type(await screen.findByLabelText(/add a task/i), 'Buy oat milk{Enter}');

    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/api/tasks') && c.method === 'POST')).toBe(true),
    );
  });

  it('invites action when the list is empty', async () => {
    renderScreen({ tasks: [] });
    expect(await screen.findByText(/nothing on the list/i)).toBeInTheDocument();
  });

  it('filters by priority through the API', async () => {
    const urls: string[] = [];
    renderScreen({ onFetch: (url) => urls.push(url) });

    await screen.findByText('Plan Kyoto trip');
    await userEvent.selectOptions(screen.getByLabelText(/priority/i), 'must');

    await waitFor(() => expect(urls.some((u) => u.includes('priority=must'))).toBe(true));
  });
});
