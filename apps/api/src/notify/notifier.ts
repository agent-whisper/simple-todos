import type { ReminderPayloadValue, WebhookKindValue } from '@simple-todos/shared';
import { renderDiscord } from './discord.js';
import { renderSlack } from './slack.js';

/** The slice of `fetch` this module uses, so tests can supply a stub. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

export interface Notifier {
  /** True when the payload was delivered. Never throws — see below. */
  send(payload: ReminderPayloadValue): Promise<boolean>;
}

export interface NotifierDeps {
  fetchImpl: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function makeNotifier(kind: WebhookKindValue, url: string, deps: NotifierDeps): Notifier {
  const render = kind === 'discord' ? renderDiscord : renderSlack;
  const sleep = deps.sleep ?? defaultSleep;

  return {
    async send(payload) {
      const body = JSON.stringify(render(payload));

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const res = await deps.fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          });
          if (res.ok) return true;
        } catch {
          // A refused connection is just another failed attempt.
        }
        if (attempt < MAX_ATTEMPTS) await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
      }

      // Deliberately no throw: a webhook outage must never break the scheduler.
      // The caller logs the false.
      return false;
    },
  };
}
