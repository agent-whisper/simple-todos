import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '../auth/session';
import { FocusScreen } from './FocusScreen';

function task(overrides: Record<string, unknown>) {
  return {
    id: 'id',
    parentId: null,
    rootId: 'id',
    position: 0,
    title: 'a task',
    notes: null,
    notesUpdatedAt: null,
    priority: 'should',
    categoryId: null,
    dueDate: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    completedAt: null,
    archivedAt: null,
    recurrenceId: null,
    occurrenceDate: null,
    workingOnAt: '2026-09-03T01:00:00.000Z',
    children: [],
    ...overrides,
  };
}

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
      if (url.includes('/settings')) {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            timezone: 'Asia/Tokyo',
            sweepTime: '03:00',
            reminderEnabled: false,
            reminderTime: '08:00',
            webhookKind: null,
            webhookUrl: null,
            updatedAt: '2026-09-01T00:00:00.000Z',
          }),
        };
      }
      return { status: 200, ok: true, json: async () => opts.tasks ?? [] };
    }) as unknown as typeof fetch,
  );

  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FocusScreen />
    </QueryClientProvider>,
  );
}

describe('FocusScreen', () => {
  it('asks the API only for what is being worked on', async () => {
    const urls: string[] = [];
    renderScreen({ onFetch: (url) => urls.push(url) });

    await waitFor(() => expect(urls.some((u) => u.includes('/tasks'))).toBe(true));
    expect(urls.find((u) => u.includes('/tasks'))).toContain('workingOn=true');
  });

  it('lists the flagged tasks', async () => {
    renderScreen({ tasks: [task({ id: 'a', rootId: 'a', title: 'The one in hand' })] });

    expect(await screen.findByText('The one in hand')).toBeInTheDocument();
  });

  it('shows the trail of parents the API sends with a flagged subtask', async () => {
    renderScreen({
      tasks: [
        task({
          id: 'root',
          rootId: 'root',
          title: 'Project',
          workingOnAt: null,
          children: [task({ id: 'step', parentId: 'root', rootId: 'root', title: 'The step' })],
        }),
      ],
    });

    // The parent is only here as context; the step is the thing being worked on.
    expect(await screen.findByText('Project')).toBeInTheDocument();
    expect(screen.getByText('The step')).toBeInTheDocument();
    expect(screen.getByText('working on')).toBeInTheDocument();
  });

  it('says what the page is for when nothing is flagged', async () => {
    renderScreen({ tasks: [] });

    expect(await screen.findByText(/nothing/i)).toBeInTheDocument();
  });

  it('drops a task off the page from here', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    renderScreen({
      tasks: [task({ id: 'a', rootId: 'a', title: 'The one in hand' })],
      onFetch: (url, init) => calls.push({ url, init }),
    });
    await screen.findByText('The one in hand');

    await userEvent.click(
      screen.getByRole('button', { name: /stop working on The one in hand/i }),
    );

    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.init?.method === 'PATCH')!;
    expect(JSON.parse(String(patch.init?.body))).toEqual({ workingOn: false });
  });

  it('ticks a task off from here too', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    renderScreen({
      tasks: [task({ id: 'a', rootId: 'a', title: 'The one in hand' })],
      onFetch: (url, init) => calls.push({ url, init }),
    });
    await screen.findByText('The one in hand');

    await userEvent.click(screen.getByRole('checkbox', { name: 'The one in hand' }));

    await waitFor(() => expect(calls.some((c) => c.url.includes('/complete'))).toBe(true));
  });

  it('offers no drag handle, there being no order to arrange here', async () => {
    renderScreen({ tasks: [task({ id: 'a', rootId: 'a', title: 'The one in hand' })] });
    await screen.findByText('The one in hand');

    expect(document.querySelector('[draggable="true"]')).toBeNull();
  });
});
