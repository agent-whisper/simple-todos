import type { ReminderPayloadValue } from '@simple-todos/shared';
import { describe, expect, it } from 'vitest';
import { renderDiscord } from './discord.js';
import { makeNotifier, type FetchLike } from './notifier.js';
import { renderSlack } from './slack.js';

const payload: ReminderPayloadValue = {
  date: '2026-09-01',
  timezone: 'Asia/Tokyo',
  overdue: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'File taxes',
      priority: 'must',
      categoryName: 'Chores',
      dueDate: '2026-08-20',
    },
  ],
  dueToday: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Book flights',
      priority: 'should',
      categoryName: null,
      dueDate: '2026-09-01',
    },
  ],
  repeatsToday: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Exercise',
      priority: 'should',
      categoryName: 'Health',
      dueDate: '2026-09-01',
    },
  ],
  completedYesterday: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Fix the sink',
      priority: 'could',
      categoryName: 'Chores',
      dueDate: null,
    },
  ],
  missedYesterday: ['Stretch'],
};

const empty: ReminderPayloadValue = {
  date: '2026-09-01',
  timezone: 'Asia/Tokyo',
  overdue: [],
  dueToday: [],
  repeatsToday: [],
  completedYesterday: [],
  missedYesterday: [],
};

function stubFetch(responses: { ok: boolean; status: number }[]): {
  fetchImpl: FetchLike;
  calls: { url: string; body: string; headers: Record<string, string> }[];
} {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  let i = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body, headers: init.headers });
    return responses[Math.min(i++, responses.length - 1)]!;
  };
  return { fetchImpl, calls };
}

const noSleep = async () => {};

describe('renderDiscord', () => {
  it('carries every section that has content', () => {
    const body = JSON.stringify(renderDiscord(payload));
    for (const needle of ['File taxes', 'Book flights', 'Exercise', 'Fix the sink', 'Stretch']) {
      expect(body).toContain(needle);
    }
  });

  it('labels priorities by their user-facing names', () => {
    const body = JSON.stringify(renderDiscord(payload));
    expect(body).toContain('Must');
    expect(body).toContain('Should');
  });

  it('includes the category name when there is one', () => {
    expect(JSON.stringify(renderDiscord(payload))).toContain('Chores');
  });

  it('omits empty sections rather than printing empty headings', () => {
    const body = JSON.stringify(renderDiscord(empty));
    expect(body).not.toContain('Overdue');
    expect(body).not.toContain('Completed yesterday');
  });

  it('says something rather than nothing on a completely quiet day', () => {
    expect(JSON.stringify(renderDiscord(empty))).toContain('Nothing scheduled');
  });
});

describe('renderSlack', () => {
  it('carries every section that has content', () => {
    const body = JSON.stringify(renderSlack(payload));
    for (const needle of ['File taxes', 'Book flights', 'Exercise', 'Fix the sink', 'Stretch']) {
      expect(body).toContain(needle);
    }
  });

  it('omits empty sections', () => {
    expect(JSON.stringify(renderSlack(empty))).not.toContain('Overdue');
  });

  it('renders a different shape from Discord', () => {
    // Slack uses blocks, Discord uses embeds — the same payload must not
    // produce the same request body.
    expect(JSON.stringify(renderSlack(payload))).not.toBe(JSON.stringify(renderDiscord(payload)));
  });
});

describe('makeNotifier', () => {
  it('posts once on success and reports true', async () => {
    const { fetchImpl, calls } = stubFetch([{ ok: true, status: 204 }]);
    const notifier = makeNotifier('discord', 'https://example.test/hook', { fetchImpl, sleep: noSleep });

    await expect(notifier.send(payload)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://example.test/hook');
  });

  it('retries a failing send three times, then gives up without throwing', async () => {
    const { fetchImpl, calls } = stubFetch([{ ok: false, status: 500 }]);
    const notifier = makeNotifier('slack', 'https://example.test/hook', { fetchImpl, sleep: noSleep });

    // Giving up quietly is the point: a webhook outage must never break the
    // scheduler or the app.
    await expect(notifier.send(payload)).resolves.toBe(false);
    expect(calls).toHaveLength(3);
  });

  it('stops retrying as soon as one attempt succeeds', async () => {
    const { fetchImpl, calls } = stubFetch([
      { ok: false, status: 502 },
      { ok: true, status: 204 },
    ]);
    const notifier = makeNotifier('discord', 'https://example.test/hook', { fetchImpl, sleep: noSleep });

    await expect(notifier.send(payload)).resolves.toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('swallows a thrown network error and keeps retrying', async () => {
    let attempts = 0;
    const fetchImpl: FetchLike = async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('ECONNREFUSED');
      return { ok: true, status: 204 };
    };
    const notifier = makeNotifier('discord', 'https://example.test/hook', { fetchImpl, sleep: noSleep });

    await expect(notifier.send(payload)).resolves.toBe(true);
    expect(attempts).toBe(3);
  });

  it('backs off for longer between each attempt', async () => {
    const delays: number[] = [];
    const { fetchImpl } = stubFetch([{ ok: false, status: 500 }]);
    const notifier = makeNotifier('discord', 'https://example.test/hook', {
      fetchImpl,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    await notifier.send(payload);

    expect(delays).toHaveLength(2); // between three attempts
    expect(delays[1]!).toBeGreaterThan(delays[0]!);
  });

  it('sends JSON with the right content type', async () => {
    const { fetchImpl, calls } = stubFetch([{ ok: true, status: 204 }]);
    const notifier = makeNotifier('discord', 'https://example.test/hook', { fetchImpl, sleep: noSleep });

    await notifier.send(payload);

    expect(calls[0]!.headers['content-type']).toContain('application/json');
    expect(() => JSON.parse(calls[0]!.body)).not.toThrow();
  });

  it('sends the renderer body matching its kind', async () => {
    const { fetchImpl, calls } = stubFetch([{ ok: true, status: 204 }]);
    await makeNotifier('slack', 'https://example.test/hook', { fetchImpl, sleep: noSleep }).send(payload);
    expect(calls[0]!.body).toBe(JSON.stringify(renderSlack(payload)));
  });
});
