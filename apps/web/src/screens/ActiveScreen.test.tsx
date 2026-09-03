import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

/** A task's row, found via its checkbox's accessible name. Rows are drop targets. */
function taskRow(title: string): HTMLElement {
  const row = screen.getByRole('checkbox', { name: title }).closest('.task');
  if (!row) throw new Error(`no row for "${title}"`);
  return row as HTMLElement;
}

/** The grip that starts a drag. Rows are not draggable; the handle is. */
function dragHandle(title: string): HTMLElement {
  const grip = taskRow(title).querySelector('[draggable="true"]');
  if (!grip) throw new Error(`"${title}" has no drag handle`);
  return grip as HTMLElement;
}

/** jsdom implements no DataTransfer, so the parts the screen touches stand in. */
function transfer() {
  const store = new Map<string, string>();
  return {
    dropEffect: '',
    effectAllowed: '',
    setData: (k: string, v: string) => store.set(k, v),
    getData: (k: string) => store.get(k) ?? '',
    setDragImage: () => {},
  };
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

  it('orders Repeating, then Active Tasks, then categories by their position', async () => {
    renderScreen();
    await screen.findByText('Loose end one');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      'Repeating today',
      'Active Tasks',
      'EG-OPM',
      'Energygazer Dashboard',
    ]);
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

describe('editing a task', () => {
  it('offers an edit button on every task', async () => {
    renderScreen();
    await screen.findByText('Loose end one');
    expect(screen.getByRole('button', { name: /edit Loose end one/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit Its subtask/i })).toBeInTheDocument();
  });

  it('opens the dialog prefilled with what the task already is', async () => {
    renderScreen({
      tasks: [
        task({
          id: 'eg-1',
          rootId: 'eg-1',
          title: 'Update the cert flow',
          priority: 'must',
          dueDate: '2026-09-20',
          notes: 'blocked on the CA',
        }),
      ],
    });
    await screen.findByText('Update the cert flow');

    await userEvent.click(screen.getByRole('button', { name: /edit Update the cert flow/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/title/i)).toHaveValue('Update the cert flow');
    expect(within(dialog).getByLabelText(/priority/i)).toHaveValue('must');
    expect(within(dialog).getByLabelText(/deadline/i)).toHaveValue('2026-09-20');
    expect(within(dialog).getByLabelText(/note/i)).toHaveValue('blocked on the CA');
  });

  it('saves with PATCH, not by creating a second task', async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    renderScreen({
      onFetch: (url, init) => calls.push({ url, method: init?.method, body: String(init?.body ?? '') }),
    });
    await screen.findByText('Loose end one');

    await userEvent.click(screen.getByRole('button', { name: /edit Loose end one/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText(/title/i));
    await userEvent.type(within(dialog).getByLabelText(/title/i), 'Loose end, renamed');
    await userEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toContain('/tasks/loose-1');
    expect(JSON.parse(patch.body!)).toMatchObject({ title: 'Loose end, renamed' });
    expect(calls.some((c) => c.url.endsWith('/api/tasks') && c.method === 'POST')).toBe(false);
  });

  it('offers a category picker when editing, so a misfiled task can be moved', async () => {
    // On create the button already decided the category; on edit it is the only
    // place a task can be moved between groups.
    renderScreen();
    await screen.findByText('Loose end one');

    await userEvent.click(screen.getByRole('button', { name: /edit Loose end one/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/category/i)).toBeInTheDocument();
  });

  it('can clear a deadline that was set', async () => {
    const calls: { method?: string; body?: string }[] = [];
    renderScreen({
      tasks: [task({ id: 'due-1', rootId: 'due-1', title: 'Has a deadline', dueDate: '2026-09-20' })],
      onFetch: (_url, init) => calls.push({ method: init?.method, body: String(init?.body ?? '') }),
    });
    await screen.findByText('Has a deadline');

    await userEvent.click(screen.getByRole('button', { name: /edit Has a deadline/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText(/deadline/i));
    await userEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body!).dueDate).toBeNull();
  });
});

describe('the row actions are reachable', () => {
  it('gives all three actions an accessible name', async () => {
    renderScreen();
    await screen.findByText('Loose end one');
    for (const name of [
      /add a subtask to Loose end one/i,
      /edit Loose end one/i,
      /delete Loose end one/i,
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
});

describe('deleting asks first', () => {
  it('does not delete on the first click', async () => {
    const calls: { method?: string }[] = [];
    renderScreen({ onFetch: (_url, init) => calls.push({ method: init?.method }) });
    await screen.findByText('Loose end one');

    await userEvent.click(screen.getByRole('button', { name: /delete Loose end one/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('names the task it is about to delete', async () => {
    renderScreen();
    await screen.findByText('Loose end one');

    await userEvent.click(screen.getByRole('button', { name: /delete Loose end one/i }));

    expect(await screen.findByRole('dialog')).toHaveAccessibleName(/Loose end one/i);
  });

  it('warns that the subtasks go too, and says how many', async () => {
    // This is the dangerous part: deleting a parent cascades to its whole
    // subtree, and nothing on the row hints at that.
    renderScreen();
    await screen.findByText('Loose end one');

    await userEvent.click(screen.getByRole('button', { name: /delete Loose end one/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/1 subtask/i);
  });

  it('counts the whole subtree, not just the direct children', async () => {
    renderScreen({
      tasks: [
        task({
          id: 'deep',
          rootId: 'deep',
          title: 'Deep tree',
          children: [
            task({
              id: 'deep-a',
              parentId: 'deep',
              rootId: 'deep',
              title: 'Child',
              children: [
                task({ id: 'deep-a-1', parentId: 'deep-a', rootId: 'deep', title: 'Grandchild' }),
              ],
            }),
          ],
        }),
      ],
    });
    await screen.findByText('Deep tree');

    await userEvent.click(screen.getByRole('button', { name: /delete Deep tree/i }));

    expect(await screen.findByRole('dialog')).toHaveTextContent(/2 subtasks/i);
  });

  it('says nothing about subtasks when there are none', async () => {
    renderScreen({ tasks: [task({ id: 'lone', rootId: 'lone', title: 'All alone' })] });
    await screen.findByText('All alone');

    await userEvent.click(screen.getByRole('button', { name: /delete All alone/i }));

    expect(await screen.findByRole('dialog')).not.toHaveTextContent(/subtask/i);
  });

  it('deletes once confirmed', async () => {
    const calls: { url: string; method?: string }[] = [];
    renderScreen({ onFetch: (url, init) => calls.push({ url, method: init?.method }) });
    await screen.findByText('Loose end one');

    await userEvent.click(screen.getByRole('button', { name: /delete Loose end one/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/tasks/loose-1'))).toBe(true),
    );
  });

  it('leaves the task alone on cancel', async () => {
    const calls: { method?: string }[] = [];
    renderScreen({ onFetch: (_url, init) => calls.push({ method: init?.method }) });
    await screen.findByText('Loose end one');

    await userEvent.click(screen.getByRole('button', { name: /delete Loose end one/i }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});

describe('repeating tasks sit apart from ordinary ones', () => {
  const repeating = task({
    id: 'rep-1',
    rootId: 'rep-1',
    title: 'Wanikani drill',
    recurrenceId: '33333333-3333-4333-8333-333333333333',
    occurrenceDate: '2026-09-02',
    dueDate: '2026-09-02',
    categoryId: '11111111-1111-4111-8111-111111111111',
  });

  it('puts a repeat instance in its own section', async () => {
    renderScreen({ tasks: [repeating, ...TREE] });
    const rep = await section(/repeating today/i);
    expect(within(rep).getByText('Wanikani drill')).toBeInTheDocument();
  });

  it('keeps it out of its category group, so project work reads clean', async () => {
    renderScreen({ tasks: [repeating, ...TREE] });
    const eg = await section(/EG-OPM/i);
    expect(within(eg).queryByText('Wanikani drill')).not.toBeInTheDocument();
    expect(within(eg).getByText(/no active tasks/i)).toBeInTheDocument();
  });

  it('keeps ordinary tasks out of the repeating section', async () => {
    renderScreen({ tasks: [repeating, ...TREE] });
    const rep = await section(/repeating today/i);
    expect(within(rep).queryByText('Loose end one')).not.toBeInTheDocument();
  });

  it('shows the category on a repeat, since no heading says it there', async () => {
    renderScreen({ tasks: [repeating, ...TREE] });
    const rep = await section(/repeating today/i);
    expect(within(rep).getByText('EG-OPM')).toBeInTheDocument();
  });

  it('keeps its header on a day with nothing due', async () => {
    // The header is a fixture of the screen: its absence would read as "you
    // have no habits" rather than "none are due today", which are different.
    renderScreen();
    const rep = await section(/repeating today/i);
    expect(within(rep).getByText(/nothing repeating today/i)).toBeInTheDocument();
  });

  it('offers no add button there, because habits are made on the Repeating screen', async () => {
    renderScreen({ tasks: [repeating, ...TREE] });
    const rep = await section(/repeating today/i);
    expect(within(rep).queryByRole('button', { name: /add a task to/i })).not.toBeInTheDocument();
  });
});

describe('section order', () => {
  it('puts Repeating today first, because it is the only thing that expires', async () => {
    renderScreen({
      tasks: [
        ...TREE,
        task({
          id: 'rep-2',
          rootId: 'rep-2',
          title: 'Daily drill',
          recurrenceId: '33333333-3333-4333-8333-333333333333',
          occurrenceDate: '2026-09-02',
        }),
      ],
    });
    await screen.findByText('Daily drill');

    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Repeating today',
      'Active Tasks',
      'EG-OPM',
      'Energygazer Dashboard',
    ]);
  });
});

describe('archiving a task', () => {
  it('offers an archive action on every task', async () => {
    renderScreen();
    await screen.findByText('Loose end one');
    expect(screen.getByRole('button', { name: /archive Loose end one/i })).toBeInTheDocument();
  });

  it('asks first, and says the whole tree goes', async () => {
    // Archiving is necessarily a whole-tree operation, which is not obvious
    // from a button on one row.
    const calls: { method?: string }[] = [];
    renderScreen({ onFetch: (_url, init) => calls.push({ method: init?.method }) });
    await screen.findByText('Loose end one');

    await userEvent.click(screen.getByRole('button', { name: /archive Loose end one/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/whole tree|1 subtask/i);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('warns that unfinished work will be marked done', async () => {
    renderScreen();
    await screen.findByText('Loose end one');

    await userEvent.click(screen.getByRole('button', { name: /archive Loose end one/i }));

    expect(await screen.findByRole('dialog')).toHaveTextContent(/marked done/i);
  });

  it('archives once confirmed', async () => {
    const calls: { url: string; method?: string }[] = [];
    renderScreen({ onFetch: (url, init) => calls.push({ url, method: init?.method }) });
    await screen.findByText('Loose end one');

    await userEvent.click(screen.getByRole('button', { name: /archive Loose end one/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^archive$/i }));

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/tasks/loose-1/archive') && c.method === 'POST')).toBe(
        true,
      ),
    );
  });

  it('does nothing on cancel', async () => {
    const calls: { url: string }[] = [];
    renderScreen({ onFetch: (url) => calls.push({ url }) });
    await screen.findByText('Loose end one');

    await userEvent.click(screen.getByRole('button', { name: /archive Loose end one/i }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.some((c) => c.url.includes('/archive'))).toBe(false);
  });
});

describe('collapsing', () => {
  it('folds a category away, keeping its heading', async () => {
    renderScreen();
    const loose = await section(/active tasks/i);
    expect(within(loose).getByText('Loose end one')).toBeInTheDocument();

    await userEvent.click(within(loose).getByRole('button', { name: /collapse Active Tasks/i }));

    expect(within(loose).queryByText('Loose end one')).not.toBeInTheDocument();
    expect(within(loose).getByRole('heading', { name: 'Active Tasks' })).toBeInTheDocument();
  });

  it('says how many are hidden, so a folded group is not a mystery', async () => {
    renderScreen();
    const loose = await section(/active tasks/i);

    await userEvent.click(within(loose).getByRole('button', { name: /collapse Active Tasks/i }));

    expect(within(loose).getByText(/1 task/i)).toBeInTheDocument();
  });

  it('reports its state to assistive tech and flips it back', async () => {
    renderScreen();
    const loose = await section(/active tasks/i);
    const toggle = within(loose).getByRole('button', { name: /collapse Active Tasks/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(toggle);
    const reopened = within(loose).getByRole('button', { name: /expand Active Tasks/i });
    expect(reopened).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(reopened);
    expect(within(loose).getByText('Loose end one')).toBeInTheDocument();
  });

  it('folds a task subtree without hiding the task itself', async () => {
    renderScreen();
    await screen.findByText('Loose end one');
    expect(screen.getByText('Its subtask')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /collapse subtasks of Loose end one/i }));

    expect(screen.queryByText('Its subtask')).not.toBeInTheDocument();
    expect(screen.getByText('Loose end one')).toBeInTheDocument();
  });

  it('offers no subtree toggle on a task with no children', async () => {
    renderScreen();
    await screen.findByText('Its subtask');
    expect(
      screen.queryByRole('button', { name: /collapse subtasks of Its subtask/i }),
    ).not.toBeInTheDocument();
  });

  it('remembers what was folded across a remount', async () => {
    const first = renderScreen();
    const loose = await section(/active tasks/i);
    await userEvent.click(within(loose).getByRole('button', { name: /collapse Active Tasks/i }));
    first.unmount();

    renderScreen();

    const again = await section(/active tasks/i);
    expect(within(again).queryByText('Loose end one')).not.toBeInTheDocument();
  });

  it('folds each group independently', async () => {
    renderScreen();
    const loose = await section(/active tasks/i);
    await userEvent.click(within(loose).getByRole('button', { name: /collapse Active Tasks/i }));

    const dash = await section(/energygazer dashboard/i);
    expect(within(dash).getByText('Dashboard work')).toBeInTheDocument();
  });
});

describe('a subtask starts at its parent\'s priority', () => {
  const URGENT = [
    task({ id: 'must-1', rootId: 'must-1', title: 'Ship the release', priority: 'must' }),
  ];

  it('preselects the parent priority rather than the standing default', async () => {
    renderScreen({ tasks: URGENT });
    await screen.findByText('Ship the release');

    await userEvent.click(screen.getByRole('button', { name: /add a subtask to Ship the release/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/priority/i)).toHaveValue('must');
  });

  it('sends that priority when the subtask is created', async () => {
    const bodies: string[] = [];
    renderScreen({
      tasks: URGENT,
      onFetch: (url, init) => {
        if (url.endsWith('/api/tasks') && init?.method === 'POST') bodies.push(String(init.body));
      },
    });
    await screen.findByText('Ship the release');

    await userEvent.click(screen.getByRole('button', { name: /add a subtask to Ship the release/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/title/i), 'One step');
    await userEvent.click(within(dialog).getByRole('button', { name: /^add task$/i }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(JSON.parse(bodies[0]!)).toMatchObject({ priority: 'must' });
  });

  it('leaves a new top-level task at the standing default', async () => {
    renderScreen({ tasks: URGENT });
    await screen.findByText('Ship the release');

    await userEvent.click(screen.getByRole('button', { name: /add a task to Active Tasks/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/priority/i)).toHaveValue('should');
  });
});

describe('dragging a task to a new home', () => {
  function moves(calls: { url: string; init?: RequestInit }[]) {
    return calls
      .filter((c) => c.url.includes('/move'))
      .map((c) => ({ url: c.url, body: JSON.parse(String(c.init?.body)) }));
  }

  function renderDraggable() {
    const calls: { url: string; init?: RequestInit }[] = [];
    renderScreen({ onFetch: (url, init) => calls.push({ url, init }) });
    return calls;
  }

  it('drops one task onto another to make it a subtask', async () => {
    const calls = renderDraggable();
    await screen.findByText('Dashboard work');

    const dataTransfer = transfer();
    fireEvent.dragStart(dragHandle('Dashboard work'), { dataTransfer });
    fireEvent.dragOver(taskRow('Loose end one'), { dataTransfer });
    fireEvent.drop(taskRow('Loose end one'), { dataTransfer });

    await waitFor(() => expect(moves(calls)).toHaveLength(1));
    expect(moves(calls)[0]).toMatchObject({
      url: expect.stringContaining('/tasks/dash-1/move'),
      // Appended after the one child the target already has.
      body: { parentId: 'loose-1', position: 1 },
    });
  });

  it('leaves the category alone when dropping onto a task', async () => {
    const calls = renderDraggable();
    await screen.findByText('Dashboard work');

    const dataTransfer = transfer();
    fireEvent.dragStart(dragHandle('Dashboard work'), { dataTransfer });
    fireEvent.drop(taskRow('Loose end one'), { dataTransfer });

    await waitFor(() => expect(moves(calls)).toHaveLength(1));
    expect(moves(calls)[0]!.body).not.toHaveProperty('categoryId');
  });

  it('drops a task onto a category to re-file it as a top-level task there', async () => {
    const calls = renderDraggable();
    await screen.findByText('Its subtask');

    const dataTransfer = transfer();
    fireEvent.dragStart(dragHandle('Its subtask'), { dataTransfer });
    fireEvent.drop(await section('EG-OPM'), { dataTransfer });

    await waitFor(() => expect(moves(calls)).toHaveLength(1));
    expect(moves(calls)[0]).toMatchObject({
      url: expect.stringContaining('/tasks/loose-1-a/move'),
      body: { parentId: null, position: 0, categoryId: CATEGORIES[0]!.id },
    });
  });

  it('clears the category when dropped on Active Tasks', async () => {
    const calls = renderDraggable();
    await screen.findByText('Dashboard work');

    const dataTransfer = transfer();
    fireEvent.dragStart(dragHandle('Dashboard work'), { dataTransfer });
    fireEvent.drop(await section('Active Tasks'), { dataTransfer });

    await waitFor(() => expect(moves(calls)).toHaveLength(1));
    expect(moves(calls)[0]!.body).toMatchObject({ parentId: null, categoryId: null });
  });

  it('refuses to drop a task onto itself', async () => {
    const calls = renderDraggable();
    await screen.findByText('Loose end one');

    const dataTransfer = transfer();
    fireEvent.dragStart(dragHandle('Loose end one'), { dataTransfer });
    fireEvent.drop(taskRow('Loose end one'), { dataTransfer });

    await waitFor(() => expect(screen.getByText('Loose end one')).toBeInTheDocument());
    expect(moves(calls)).toHaveLength(0);
  });

  it('refuses to drop a task into its own subtree', async () => {
    const calls = renderDraggable();
    await screen.findByText('Its subtask');

    const dataTransfer = transfer();
    fireEvent.dragStart(dragHandle('Loose end one'), { dataTransfer });
    fireEvent.drop(taskRow('Its subtask'), { dataTransfer });

    await waitFor(() => expect(screen.getByText('Its subtask')).toBeInTheDocument());
    // The API would reject this with a 409; not offering it is kinder.
    expect(moves(calls)).toHaveLength(0);
  });

  it('refuses a drop that would change nothing', async () => {
    const calls = renderDraggable();
    await screen.findByText('Loose end one');

    const dataTransfer = transfer();
    fireEvent.dragStart(dragHandle('Loose end one'), { dataTransfer });
    fireEvent.drop(await section('Active Tasks'), { dataTransfer });

    await waitFor(() => expect(screen.getByText('Loose end one')).toBeInTheDocument());
    expect(moves(calls)).toHaveLength(0);
  });

  it('will not drag a repeating instance out of its section', async () => {
    renderScreen({
      tasks: [task({ id: 'rep-1', rootId: 'rep-1', title: 'Exercise', recurrenceId: 'rec-1' })],
    });
    await screen.findByText('Exercise');

    // The sweep owns these: it spawns them each morning and clears them at
    // night, so a move would be undone within a day.
    expect(taskRow('Exercise').querySelector('[draggable="true"]')).toBeNull();
  });

  it('will not drop onto a repeating instance either', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    renderScreen({
      tasks: [
        task({ id: 'rep-1', rootId: 'rep-1', title: 'Exercise', recurrenceId: 'rec-1' }),
        task({ id: 'free-1', rootId: 'free-1', title: 'Something else' }),
      ],
      onFetch: (url, init) => calls.push({ url, init }),
    });
    await screen.findByText('Exercise');

    const dataTransfer = transfer();
    fireEvent.dragStart(dragHandle('Something else'), { dataTransfer });
    const target = screen.getByRole('checkbox', { name: 'Exercise' }).closest('li')!;
    fireEvent.drop(target, { dataTransfer });

    await waitFor(() => expect(screen.getByText('Exercise')).toBeInTheDocument());
    expect(moves(calls)).toHaveLength(0);
  });
});

describe('dragging to reorder within a list', () => {
  const THREE = [
    task({ id: 'a', rootId: 'a', title: 'Alpha', position: 0 }),
    task({ id: 'b', rootId: 'b', title: 'Bravo', position: 1 }),
    task({ id: 'c', rootId: 'c', title: 'Charlie', position: 2 }),
  ];

  it('offers no landing strips until something is being dragged', async () => {
    renderScreen({ tasks: THREE });
    await screen.findByText('Alpha');

    expect(document.querySelectorAll('[data-drop]')).toHaveLength(0);
  });

  it('opens a landing strip between each pair of siblings', async () => {
    renderScreen({ tasks: THREE });
    await screen.findByText('Alpha');

    fireEvent.dragStart(dragHandle('Charlie'), { dataTransfer: transfer() });

    // Four slots for three rows, less the two either side of Charlie itself.
    const gaps = (await section('Active Tasks')).querySelectorAll('[data-drop]');
    expect(gaps).toHaveLength(2);
  });

  it('moves a task to the slot it was dropped into', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    renderScreen({ tasks: THREE, onFetch: (url, init) => calls.push({ url, init }) });
    await screen.findByText('Alpha');

    const dataTransfer = transfer();
    fireEvent.dragStart(dragHandle('Charlie'), { dataTransfer });
    const gaps = (await section('Active Tasks')).querySelectorAll('[data-drop]');
    fireEvent.drop(gaps[0]!, { dataTransfer });

    await waitFor(() => expect(calls.some((c) => c.url.includes('/move'))).toBe(true));
    const move = calls.find((c) => c.url.includes('/move'))!;
    expect(move.url).toContain('/tasks/c/move');
    expect(JSON.parse(String(move.init?.body))).toMatchObject({ parentId: null, position: 0 });
  });
});

describe('a deadline reads as a countdown', () => {
  /** The same local date the screen derives, so the fixtures line up with it. */
  function dayFromNow(offset: number): string {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
    const d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)));
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }

  async function renderDue(offset: number) {
    renderScreen({
      tasks: [task({ id: 'due-1', rootId: 'due-1', title: 'Deadline', dueDate: dayFromNow(offset) })],
    });
    await screen.findByText('Deadline');
  }

  it('says today', async () => {
    await renderDue(0);
    expect(screen.getByText('today!')).toBeInTheDocument();
  });

  it('says tomorrow', async () => {
    await renderDue(1);
    expect(screen.getByText('tomorrow')).toBeInTheDocument();
  });

  it('counts the days left', async () => {
    await renderDue(5);
    expect(screen.getByText('5 days left')).toBeInTheDocument();
  });

  it('counts the days past, for one already missed', async () => {
    await renderDue(-3);
    expect(screen.getByText('3 days late')).toBeInTheDocument();
  });

  it('keeps the date itself, for the hover to reveal', async () => {
    await renderDue(5);
    expect(screen.getByText(dayFromNow(5))).toBeInTheDocument();
  });
});

describe('searching opens the trail but not the hit', () => {
  const DEEP = [
    task({
      id: 'one',
      rootId: 'one',
      title: 'One',
      children: [
        task({
          id: 'one-two',
          rootId: 'one',
          parentId: 'one',
          title: 'One two',
          children: [
            task({
              id: 'hit',
              rootId: 'one',
              parentId: 'one-two',
              title: 'Needle',
              children: [
                task({ id: 'deep', rootId: 'one', parentId: 'hit', title: 'Under the needle' }),
              ],
            }),
          ],
        }),
      ],
    }),
  ];

  async function search() {
    renderScreen({ tasks: DEEP });
    await screen.findByText('Needle');
    await userEvent.type(screen.getByLabelText(/search/i), 'needle');
    await waitFor(() => expect(screen.getByLabelText(/search/i)).toHaveValue('needle'));
  }

  it('shows the whole trail down to the hit', async () => {
    await search();

    for (const step of ['One', 'One two', 'Needle']) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it('folds the hit itself, so its subtree does not bury it', async () => {
    await search();

    await waitFor(() => expect(screen.queryByText('Under the needle')).not.toBeInTheDocument());
  });

  it('opens the hit when asked', async () => {
    await search();
    await waitFor(() => expect(screen.queryByText('Under the needle')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /expand subtasks of Needle/i }));

    expect(await screen.findByText('Under the needle')).toBeInTheDocument();
  });

  it('leaves everything open when the search box is empty', async () => {
    renderScreen({ tasks: DEEP });

    expect(await screen.findByText('Under the needle')).toBeInTheDocument();
  });
});

describe('a slot means the same thing when groups split one sibling list', () => {
  // Every root shares one sibling list, but the screen splits it across
  // category headings, so the third row under "Active Tasks" is not the task
  // with position 3. A slot has to resolve to the position of the task it
  // lands in front of, or a reorder puts the row somewhere else entirely.
  const SPLIT = [
    task({ id: 'f', rootId: 'f', title: 'Filed away', position: 0, categoryId: CATEGORIES[0]!.id }),
    task({ id: 'x', rootId: 'x', title: 'Ex', position: 1 }),
    task({ id: 'y', rootId: 'y', title: 'Why', position: 2 }),
    task({ id: 'z', rootId: 'z', title: 'Zed', position: 3 }),
  ];

  it('sends the neighbour\'s position, not the row number under the heading', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    renderScreen({ tasks: SPLIT, onFetch: (url, init) => calls.push({ url, init }) });
    await screen.findByText('Zed');

    const dataTransfer = transfer();
    fireEvent.dragStart(dragHandle('Zed'), { dataTransfer });
    // The second landing strip under "Active Tasks": between Ex and Why.
    const gaps = (await section('Active Tasks')).querySelectorAll('[data-drop]');
    expect(gaps).toHaveLength(2);
    fireEvent.drop(gaps[1]!, { dataTransfer });

    await waitFor(() => expect(calls.some((c) => c.url.includes('/move'))).toBe(true));
    const move = calls.find((c) => c.url.includes('/move'))!;
    // Why sits at position 2, even though it is the second row in this group.
    expect(JSON.parse(String(move.init?.body))).toMatchObject({ parentId: null, position: 2 });
  });
});

describe('the drag handle is the only thing that starts a drag', () => {
  it('leaves the row itself undraggable', async () => {
    renderScreen();
    await screen.findByText('Loose end one');

    // With the whole row draggable, whether a drag started depended on where
    // you grabbed: the checkbox, the twisty and the action buttons all swallow
    // it, and pressing the title starts a text selection instead.
    expect(taskRow('Loose end one')).not.toHaveAttribute('draggable', 'true');
  });

  it('offers exactly one handle per row, and it is not a control', async () => {
    renderScreen();
    await screen.findByText('Loose end one');

    const row = taskRow('Loose end one');
    const handles = row.querySelectorAll('[draggable="true"]');
    expect(handles).toHaveLength(1);
    expect(handles[0]!.tagName).not.toBe('BUTTON');
    expect(handles[0]!.tagName).not.toBe('INPUT');
  });

  it('keeps the handle out of the accessible tree, having no keyboard action', async () => {
    renderScreen();
    await screen.findByText('Loose end one');

    expect(dragHandle('Loose end one')).toHaveAttribute('aria-hidden', 'true');
  });

  it('drags the row as the preview, not the handle', async () => {
    renderScreen();
    await screen.findByText('Loose end one');

    const dataTransfer = { ...transfer(), setDragImage: vi.fn() };
    fireEvent.dragStart(dragHandle('Loose end one'), { dataTransfer });

    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(
      taskRow('Loose end one'),
      expect.any(Number),
      expect.any(Number),
    );
  });
});
