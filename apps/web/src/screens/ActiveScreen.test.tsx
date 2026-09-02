import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '../auth/session';
import { ActiveScreen } from './ActiveScreen';

const CATEGORIES = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'EG-OPM', color: '#28407a', position: 0, createdAt: '2026-09-01T00:00:00.000Z' },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Energygazer Dashboard',
    color: '#8a3324',
    position: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
];

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
    children: [],
    ...overrides,
  };
}

const TREE = [
  task({
    id: 'loose-1',
    rootId: 'loose-1',
    title: 'Loose end one',
    children: [task({ id: 'loose-1-a', parentId: 'loose-1', rootId: 'loose-1', title: 'Its subtask' })],
  }),
  task({ id: 'dash-1', rootId: 'dash-1', title: 'Dashboard work', categoryId: '22222222-2222-4222-8222-222222222222' }),
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
      if (url.includes('/categories')) return { status: 200, ok: true, json: async () => CATEGORIES };
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
      return { status: 200, ok: true, json: async () => opts.tasks ?? TREE };
    }) as unknown as typeof fetch,
  );

  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ActiveScreen />
    </QueryClientProvider>,
  );
}

/** The section for a heading, so assertions can scope to one group. */
async function section(name: RegExp | string) {
  return screen.findByRole('region', { name });
}

describe('grouping by category', () => {
  it('puts uncategorised tasks under Active Tasks', async () => {
    renderScreen();
    const loose = await section(/active tasks/i);
    expect(await within(loose).findByText('Loose end one')).toBeInTheDocument();
  });

  it('keeps a tree intact inside its group', async () => {
    renderScreen();
    const loose = await section(/active tasks/i);
    expect(await within(loose).findByText('Its subtask')).toBeInTheDocument();
  });

  it('groups a categorised task under its category', async () => {
    renderScreen();
    const dash = await section(/energygazer dashboard/i);
    expect(await within(dash).findByText('Dashboard work')).toBeInTheDocument();
  });

  it('shows a category with nothing in it, rather than hiding it', async () => {
    renderScreen();
    const eg = await section(/EG-OPM/i);
    expect(within(eg).getByText(/no active tasks/i)).toBeInTheDocument();
  });

  it('orders Active Tasks first, then categories by their position', async () => {
    renderScreen();
    await screen.findByText('Loose end one');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Active Tasks', 'EG-OPM', 'Energygazer Dashboard']);
  });

  it('says no matches, not no tasks, when a filter is what emptied a group', async () => {
    renderScreen();
    await screen.findByText('Loose end one');

    await userEvent.type(screen.getByLabelText(/search/i), 'nothing matches this');

    await waitFor(() => expect(screen.getAllByText(/no matches/i).length).toBeGreaterThan(0));
  });
});

describe('adding from a category', () => {
  it('opens a dialog naming the category', async () => {
    renderScreen();
    const eg = await section(/EG-OPM/i);

    await userEvent.click(within(eg).getByRole('button', { name: /add a task to EG-OPM/i }));

    expect(await screen.findByRole('dialog')).toHaveAccessibleName(/EG-OPM/i);
  });

  it('does not show a category picker, because the category is already decided', async () => {
    renderScreen();
    await userEvent.click(
      within(await section(/EG-OPM/i)).getByRole('button', { name: /add a task to EG-OPM/i }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/category/i)).not.toBeInTheDocument();
  });

  it('creates the task with that category', async () => {
    const bodies: string[] = [];
    renderScreen({
      onFetch: (url, init) => {
        if (url.endsWith('/api/tasks') && init?.method === 'POST') bodies.push(String(init.body));
      },
    });

    await userEvent.click(
      within(await section(/EG-OPM/i)).getByRole('button', { name: /add a task to EG-OPM/i }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/title/i), 'Renew the cert');
    await userEvent.click(within(dialog).getByRole('button', { name: /^add task$/i }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(JSON.parse(bodies[0]!)).toMatchObject({ title: 'Renew the cert', categoryId: '11111111-1111-4111-8111-111111111111' });
  });

  it('sends no categoryId when adding to Active Tasks', async () => {
    const bodies: string[] = [];
    renderScreen({
      onFetch: (url, init) => {
        if (url.endsWith('/api/tasks') && init?.method === 'POST') bodies.push(String(init.body));
      },
    });

    await userEvent.click(
      within(await section(/active tasks/i)).getByRole('button', { name: /add a task/i }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/title/i), 'Something loose');
    await userEvent.click(within(dialog).getByRole('button', { name: /^add task$/i }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(JSON.parse(bodies[0]!).categoryId).toBeUndefined();
  });

  it('carries priority, deadline and a note through', async () => {
    const bodies: string[] = [];
    renderScreen({
      onFetch: (url, init) => {
        if (url.endsWith('/api/tasks') && init?.method === 'POST') bodies.push(String(init.body));
      },
    });

    await userEvent.click(
      within(await section(/active tasks/i)).getByRole('button', { name: /add a task/i }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/title/i), 'Full one');
    await userEvent.selectOptions(within(dialog).getByLabelText(/priority/i), 'must');
    await userEvent.type(within(dialog).getByLabelText(/deadline/i), '2026-09-20');
    await userEvent.type(within(dialog).getByLabelText(/note/i), 'context here');
    await userEvent.click(within(dialog).getByRole('button', { name: /^add task$/i }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(JSON.parse(bodies[0]!)).toMatchObject({
      title: 'Full one',
      priority: 'must',
      dueDate: '2026-09-20',
      notes: 'context here',
    });
  });

  it('closes on cancel without creating anything', async () => {
    const posts: string[] = [];
    renderScreen({
      onFetch: (url, init) => {
        if (url.endsWith('/api/tasks') && init?.method === 'POST') posts.push(String(init.body));
      },
    });

    await userEvent.click(
      within(await section(/active tasks/i)).getByRole('button', { name: /add a task/i }),
    );
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(posts).toHaveLength(0);
  });

  it('refuses an empty title rather than creating a blank task', async () => {
    const posts: string[] = [];
    renderScreen({
      onFetch: (url, init) => {
        if (url.endsWith('/api/tasks') && init?.method === 'POST') posts.push(String(init.body));
      },
    });

    await userEvent.click(
      within(await section(/active tasks/i)).getByRole('button', { name: /add a task/i }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^add task$/i }));

    expect(posts).toHaveLength(0);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('adding a subtask', () => {
  it('opens a dialog naming the parent task', async () => {
    renderScreen();
    await screen.findByText('Loose end one');

    await userEvent.click(screen.getByRole('button', { name: /add a subtask to Loose end one/i }));

    expect(await screen.findByRole('dialog')).toHaveAccessibleName(/Loose end one/i);
  });

  it('creates it under that parent', async () => {
    const bodies: string[] = [];
    renderScreen({
      onFetch: (url, init) => {
        if (url.endsWith('/api/tasks') && init?.method === 'POST') bodies.push(String(init.body));
      },
    });
    await screen.findByText('Loose end one');

    await userEvent.click(screen.getByRole('button', { name: /add a subtask to Loose end one/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/title/i), 'A new step');
    await userEvent.click(within(dialog).getByRole('button', { name: /^add task$/i }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(JSON.parse(bodies[0]!)).toMatchObject({ title: 'A new step', parentId: 'loose-1' });
  });

  it('offers the button on a subtask too, so nesting can go deeper', async () => {
    renderScreen();
    await screen.findByText('Its subtask');
    expect(screen.getByRole('button', { name: /add a subtask to Its subtask/i })).toBeInTheDocument();
  });
});

describe('the rest of the screen still works', () => {
  it('completes a task through the API', async () => {
    const calls: { url: string; method?: string }[] = [];
    renderScreen({ onFetch: (url, init) => calls.push({ url, method: init?.method }) });

    await userEvent.click(await screen.findByRole('checkbox', { name: /loose end one/i }));

    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/complete') && c.method === 'POST')).toBe(true),
    );
  });

  it('labels the priority in text, not only by the rule weight', async () => {
    renderScreen();
    expect((await screen.findAllByText('Should')).length).toBeGreaterThan(0);
  });

  it('lets each group state its own emptiness rather than saying it twice', async () => {
    // Every group already prints "(no active tasks)", so a global empty state
    // on top of that was the same sentence three times over.
    renderScreen({ tasks: [] });
    expect(await screen.findByRole('region', { name: /active tasks/i })).toBeInTheDocument();
    expect(screen.getAllByText(/no active tasks/i)).toHaveLength(3);
    expect(screen.queryByText(/nothing on the list/i)).not.toBeInTheDocument();
  });
});

describe('chips say something the heading does not', () => {
  it('omits the category chip when it matches the group it is in', async () => {
    renderScreen({
      tasks: [
        task({
          id: 'eg-1',
          rootId: 'eg-1',
          title: 'Update the cert flow',
          categoryId: '11111111-1111-4111-8111-111111111111',
        }),
      ],
    });

    const eg = await section(/EG-OPM/i);
    const list = within(eg).getByRole('list');
    expect(within(list).getByText('Update the cert flow')).toBeInTheDocument();
    // The heading already says EG-OPM; repeating it on every row is noise. Scoped
    // to the list so the section's own heading does not satisfy the query.
    expect(within(list).queryByText(/^EG-OPM$/)).not.toBeInTheDocument();
  });

  it('keeps the chip on a subtask filed under a different category', async () => {
    renderScreen({
      tasks: [
        task({
          id: 'loose-2',
          rootId: 'loose-2',
          title: 'A loose root',
          children: [
            task({
              id: 'loose-2-a',
              parentId: 'loose-2',
              rootId: 'loose-2',
              title: 'But this one is EG',
              categoryId: '11111111-1111-4111-8111-111111111111',
            }),
          ],
        }),
      ],
    });

    const loose = await section(/active tasks/i);
    expect(await within(loose).findByText('EG-OPM')).toBeInTheDocument();
  });
});
