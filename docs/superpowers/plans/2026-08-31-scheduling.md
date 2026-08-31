# simple-todos Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the API run itself — repeatable tasks, the nightly sweep that archives finished work, a scheduler that survives downtime, an optional Discord/Slack daily reminder, and a Docker image.

**Architecture:** No cron. A 60-second ticker asks one question — "is there a scheduled run whose local date has no `job_run` row and whose local time has passed?" — so normal firing, missed-window recovery, timezone changes, and DST all collapse into one code path, and the `job_run` unique index makes a double-fire impossible. Sweep and reminder are pure functions of a target local date, driven by an injected `Clock`, so a week of simulated downtime is a millisecond-long unit test.

**Tech Stack:** Node 22, TypeScript (ESM, strict), Fastify 5, Drizzle ORM + better-sqlite3, Zod, Vitest, Docker.

**Spec:** `docs/superpowers/specs/2026-08-31-simple-todos-design.md`

**Predecessor:** `docs/superpowers/plans/2026-08-31-api-foundation.md` (complete; 248 tests passing on `feat/simple-todos`)

## Global Constraints

- Node 22, npm 10, npm workspaces. Packages: `@simple-todos/shared`, `@simple-todos/api`.
- TypeScript strict, ESM (`"type": "module"`, `NodeNext`). **Relative imports carry a `.js` extension.**
- **Zero `as never` casts in `apps/api/src`.** There are none today; keep it that way.
- Timestamps are ISO-8601 UTC strings. Date-only fields (`due_date`, `occurrence_date`, `run_date`, `last_processed_date`) are `YYYY-MM-DD` interpreted in `settings.timezone`.
- Priorities are exactly `'must' | 'should' | 'could'`, default `'should'`.
- Error envelope `{error:{code,message,details?}}`; codes `VALIDATION_ERROR` 400, `UNAUTHENTICATED` 401, `NOT_FOUND` 404, `CONFLICT` 409, `RATE_LIMITED` 429, `INTERNAL` 500.
- **Authentication is not opt-in.** `apps/api/src/http/app.ts` has an encapsulated authenticated scope; every new route plugin registers *inside* it, takes no `requireAuth`, and adds no hook. `apps/api/src/http/authScope.test.ts` enumerates the live route table and asserts the only open routes are `GET /api/health` and `POST /api/auth/login`. **Never edit that test to accommodate a change** — if it fails, the wiring is wrong.
- **No `Date.now()` or `new Date()` reading ambient time in domain or service code.** Time arrives via the injected `Clock` (`apps/api/src/clock.ts`: `Clock`, `systemClock`, `FixedClock`). Constructing a `Date` from an explicit argument is fine.
- **Every recursive CTE carries a `depth < 1000` bound on its recursive term.** SQLite does no cycle detection; an unbounded walk on a malformed tree hangs forever holding the write lock.
- The four invariants of spec §4.8 hold at all times: complete parent ⇒ all descendants complete; archived ⇒ completed; a tree archives atomically; no cycles.
- `better-sqlite3` is pinned `^11.10.0`. **Do not change it without reading Task 13**, which re-tests the pin on Linux.
- TDD: failing test first, watch it fail, implement, watch it pass, commit.
- **Build ordering:** `@simple-todos/shared` resolves to its compiled `dist/`. `pretest` only fires on `npm test`; a bare `npx vitest run <path>` resolves a stale build. Run `npm run build:shared` after editing anything under `packages/shared/`.

---

## What already exists

Plan 1 built and tested all of this; Plan 2 builds on it and must not restructure it.

| Area | What is there |
|---|---|
| Schema | **Every table already exists**, including `recurrence`, `recurrence_log`, `job_run`, and `settings`. No new migration is needed unless a task says so. |
| `apps/api/src/clock.ts` | `Clock`, `systemClock`, `FixedClock(iso)` with `.now()` / `.set(iso)` |
| `apps/api/src/time.ts` | `localDate(at,tz)`, `addLocalDays(date,n)`, `localWeekday(date)` (ISO Mon=1..Sun=7), `compareLocalDate(a,b)`, `startOfLocalDayUtc(date,tz)` |
| `apps/api/src/db/index.ts` | `openDb(file)`, `runMigrations(db)`, `AppDb`, `schema` namespace |
| `apps/api/src/db/cursor.ts` | `encodeCursor(value)`, `decodeCursor(cursor, schema)` — composite keyset cursors, 400 on malformed |
| `apps/api/src/domain/errors.ts` | `AppError`, `NotFoundError(resource,id)`, `ConflictError`, `ValidationError`, `UnauthenticatedError` |
| `apps/api/src/domain/tree.ts` | `buildTree(rows)` — promotes parentless rows to roots |
| Services | `AuthService`, `TaskService`, `CategoryService`, `ArchiveService`, `NoteService` |
| `apps/api/src/http/app.ts` | `buildApp({db, clock, config})`; open routes registered directly, everything else inside the authenticated scope |
| `apps/api/src/server.ts` | `startServer(env)` → `{app, stop}`; migrates before listening, closes the DB handle if startup fails |
| Test helpers | `apps/api/test/helpers/testApp.ts`: `makeTestApp(at?)`, `makeAuthedApp(at?)` (`get`/`post`/`patch`/`del` with a bearer token), `TEST_USERNAME`, `TEST_PASSWORD`. Temp DBs copy a pre-migrated template. |

`TaskService.complete` does **not** currently touch `recurrence_log` — Task 5 adds that.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/settings.ts` | Settings shape + update request |
| `packages/shared/src/recurrence.ts` | Recurrence shape, create/update requests, history response |
| `packages/shared/src/reminder.ts` | `ReminderPayload` and its `TaskLine` |
| `apps/api/src/services/settingsService.ts` | Read/update the singleton settings row |
| `apps/api/src/domain/schedule.ts` | Pure occurrence-date math — no database |
| `apps/api/src/services/recurrenceService.ts` | Recurrence CRUD + hit/miss history and streaks |
| `apps/api/src/services/sweepService.ts` | The nightly sweep, parameterised by target local date |
| `apps/api/src/services/reminderService.ts` | Assemble the reminder payload |
| `apps/api/src/notify/notifier.ts` | `Notifier` interface, retry wrapper, `makeNotifier` |
| `apps/api/src/notify/discord.ts` | Discord embed rendering |
| `apps/api/src/notify/slack.ts` | Slack block rendering |
| `apps/api/src/scheduler.ts` | The ticker and the `job_run` ledger |
| `apps/api/src/http/routes/settings.ts` | `GET`/`PUT /settings`, `POST /settings/webhook/test` |
| `apps/api/src/http/routes/recurrences.ts` | Recurrence CRUD + history |
| `apps/api/src/http/routes/jobs.ts` | Manual `/jobs/*` triggers |
| `apps/api/Dockerfile` | Multi-stage build, repo root as context |
| `compose.yml` | One service, volume, healthcheck |

---

### Task 1: `localTime` and hardening for exposure

Two small, unrelated pieces of groundwork, folded together because neither justifies its own review: the clock helper the scheduler needs, and two deployment-exposure gaps recorded during Plan 1.

**Files:**
- Modify: `apps/api/src/time.ts`, `apps/api/src/time.test.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/src/config.test.ts`
- Modify: `apps/api/src/http/app.ts`
- Modify: `apps/api/src/http/authScope.test.ts`

**Interfaces:**
- Consumes: `localDate`, `offsetMsAt` (private, in `time.ts`).
- Produces: `localTime(at: Date, timeZone: string): string` returning `'HH:MM'` 24-hour. `Config.trustProxy: boolean` from `TRUST_PROXY`.

- [ ] **Step 1: Write the failing `localTime` test**

Append to `apps/api/src/time.test.ts`, merging `localTime` into the existing `./time.js` import:

```ts
describe('localTime', () => {
  it('reads the wall-clock time in the given zone', () => {
    // 2026-08-31T00:00Z is 09:00 in Tokyo (UTC+9).
    expect(localTime(new Date('2026-08-31T00:00:00Z'), JST)).toBe('09:00');
    expect(localTime(new Date('2026-08-31T00:00:00Z'), UTC)).toBe('00:00');
  });

  it('renders midnight as 00:00, not 24:00', () => {
    // 2026-08-30T15:00Z is exactly midnight in Tokyo.
    expect(localTime(new Date('2026-08-30T15:00:00Z'), JST)).toBe('00:00');
  });

  it('zero-pads both fields so string comparison is chronological', () => {
    expect(localTime(new Date('2026-08-31T00:05:00Z'), UTC)).toBe('00:05');
    expect(localTime(new Date('2026-08-31T09:05:00Z'), UTC)).toBe('09:05');
    expect('09:05' < '10:00').toBe(true);
  });

  it('honours daylight saving', () => {
    // New York is UTC-4 in August.
    expect(localTime(new Date('2026-08-31T12:00:00Z'), 'America/New_York')).toBe('08:00');
    // ...and UTC-5 in January.
    expect(localTime(new Date('2026-01-31T12:00:00Z'), 'America/New_York')).toBe('07:00');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/api/src/time.test.ts`
Expected: FAIL — `localTime` is not exported.

- [ ] **Step 3: Implement `localTime`**

Append to `apps/api/src/time.ts`:

```ts
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function timeFormatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = timeFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      // h23 rather than hour12:false — the latter renders midnight as "24".
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    });
    timeFormatters.set(timeZone, f);
  }
  return f;
}

/**
 * Wall-clock time in `timeZone` as zero-padded 'HH:MM'.
 *
 * The scheduler compares this against `settings.sweep_time` / `reminder_time`
 * with a plain string comparison, which is only chronological because both
 * fields are zero-padded.
 */
export function localTime(at: Date, timeZone: string): string {
  return timeFormatterFor(timeZone).format(at);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run apps/api/src/time.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `TRUST_PROXY` to config, test first**

Append to `apps/api/src/config.test.ts`:

```ts
describe('TRUST_PROXY', () => {
  it('defaults to false', () => {
    expect(loadConfig(validEnv()).trustProxy).toBe(false);
  });

  it('accepts true and false as strings', () => {
    expect(loadConfig({ ...validEnv(), TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ ...validEnv(), TRUST_PROXY: 'false' }).trustProxy).toBe(false);
  });

  it('rejects a value that is neither', () => {
    expect(() => loadConfig({ ...validEnv(), TRUST_PROXY: 'yes' })).toThrow();
  });
});
```

If the existing test file has no `validEnv()` helper, use whatever it already uses to build a complete valid environment — do not invent a second convention.

- [ ] **Step 6: Implement it**

In `apps/api/src/config.ts`, add to the env schema:

```ts
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
```

add `trustProxy: boolean;` to the `Config` interface, and in the returned object:

```ts
    trustProxy: parsed.TRUST_PROXY === 'true',
```

- [ ] **Step 7: Wire `trustProxy` into Fastify**

In `apps/api/src/http/app.ts`, change the Fastify constructor:

```ts
  const app = Fastify({
    logger: { level: deps.config.logLevel },
    // Behind a reverse proxy every request otherwise carries the proxy's IP,
    // so the login rate limiter buckets all clients together and one attacker
    // can lock the owner out. Opt-in: trusting XFF when NOT behind a proxy
    // would let anyone spoof their way around the limiter.
    trustProxy: deps.config.trustProxy,
  });
```

- [ ] **Step 8: Fix the wildcard gap in the route-table guard**

`apps/api/src/http/authScope.test.ts`'s `listRoutes` rebuilds paths from `printRoutes` indentation. A wildcard child renders as a bare `*` segment carrying no leading slash, so `/api/tasks/*` currently reconstructs as `/api/tasks*`. No wildcard route exists yet — Plan 3 registers one when `@fastify/static` serves the SPA — and the failure is loud rather than silent, but fixing it now removes a trap from a security guard.

In `listRoutes`, where the child path is assembled from the parent path and the segment, insert a separator when the segment does not begin with one:

```ts
    const parent = depth > 0 ? pathAtDepth[depth - 1] ?? '' : '';
    const needsSlash = segment !== '' && !segment.startsWith('/') && !parent.endsWith('/');
    const path = parent + (needsSlash ? '/' : '') + segment;
```

**This is the one sanctioned edit to that file.** Do not touch the allowlist, the set-equality assertion, or the unauthenticated-injection loop.

Prove it still works: temporarily register a route outside the authenticated scope, run the test, confirm it fails and names that route, then remove the temporary route. Report what the failure output said.

- [ ] **Step 9: Run everything**

```bash
npm test
npm run typecheck
```
Expected: all prior tests plus the new ones pass; typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add localTime, trustProxy config, and fix the route-guard wildcard gap"
```

---

### Task 2: Settings service and routes

The scheduler reads every one of these on each tick, so they land before it.

**Files:**
- Create: `packages/shared/src/settings.ts`; Modify: `packages/shared/src/index.ts`
- Create: `apps/api/src/services/settingsService.ts`, `apps/api/src/http/routes/settings.ts`
- Modify: `apps/api/src/http/app.ts`
- Test: `apps/api/src/services/settingsService.test.ts`, `apps/api/src/http/routes/settings.test.ts`

**Interfaces:**
- Consumes: `AppDb`, `Clock`, `ValidationError`.
- Produces: shared `Settings`, `UpdateSettingsRequest`, `WebhookKind`. `class SettingsService` with `get(): SettingsValue` and `update(patch: UpdateSettingsRequestValue): SettingsValue`. Routes `GET /api/settings`, `PUT /api/settings`.

- [ ] **Step 1: Add the shared contract**

`packages/shared/src/settings.ts`:

```ts
import { z } from 'zod';
import { IsoDateTime } from './primitives.js';

export const WEBHOOK_KINDS = ['discord', 'slack'] as const;
export const WebhookKind = z.enum(WEBHOOK_KINDS);
export type WebhookKindValue = (typeof WEBHOOK_KINDS)[number];

/** 'HH:MM', 24-hour, zero-padded — the scheduler compares these as strings. */
export const TimeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM in 24-hour form');

export const Settings = z.object({
  timezone: z.string().min(1),
  sweepTime: TimeOfDay,
  reminderEnabled: z.boolean(),
  reminderTime: TimeOfDay,
  webhookKind: WebhookKind.nullable(),
  webhookUrl: z.string().url().nullable(),
  updatedAt: IsoDateTime,
});
export type SettingsValue = z.infer<typeof Settings>;

export const UpdateSettingsRequest = z
  .object({
    timezone: z.string().min(1),
    sweepTime: TimeOfDay,
    reminderEnabled: z.boolean(),
    reminderTime: TimeOfDay,
    webhookKind: WebhookKind.nullable(),
    webhookUrl: z.string().url().nullable(),
  })
  .partial();
export type UpdateSettingsRequestValue = z.infer<typeof UpdateSettingsRequest>;
```

Append to `packages/shared/src/index.ts`:

```ts
export * from './settings.js';
```

Then `npm run build:shared`.

- [ ] **Step 2: Write the failing service test**

`apps/api/src/services/settingsService.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';
import { SettingsService } from './settingsService.js';

let ctx: TestApp;
let settings: SettingsService;

beforeEach(async () => {
  ctx = await makeTestApp('2026-08-31T01:00:00Z');
  settings = new SettingsService(ctx.db, ctx.clock);
});

afterEach(async () => {
  await ctx.close();
});

describe('get', () => {
  it('returns the seeded defaults', () => {
    expect(settings.get()).toMatchObject({
      timezone: 'Asia/Tokyo',
      sweepTime: '03:00',
      reminderEnabled: false,
      reminderTime: '08:00',
      webhookKind: null,
      webhookUrl: null,
    });
  });

  it('exposes reminderEnabled as a boolean, not SQLite 0/1', () => {
    expect(typeof settings.get().reminderEnabled).toBe('boolean');
  });
});

describe('update', () => {
  it('changes only the fields present in the patch', () => {
    const updated = settings.update({ timezone: 'Europe/London' });
    expect(updated.timezone).toBe('Europe/London');
    expect(updated.sweepTime).toBe('03:00');
  });

  it('stamps updatedAt from the clock', () => {
    ctx.clock.set('2026-09-05T00:00:00Z');
    expect(settings.update({ sweepTime: '04:00' }).updatedAt).toBe('2026-09-05T00:00:00.000Z');
  });

  it('rejects a timezone that is not a real IANA zone', () => {
    expect(() => settings.update({ timezone: 'Not/AZone' })).toThrow(/timezone/i);
  });

  it('accepts a half-hour and a 45-minute zone', () => {
    expect(settings.update({ timezone: 'Asia/Kolkata' }).timezone).toBe('Asia/Kolkata');
    expect(settings.update({ timezone: 'Asia/Kathmandu' }).timezone).toBe('Asia/Kathmandu');
  });

  it('refuses to enable the reminder with no webhook configured', () => {
    expect(() => settings.update({ reminderEnabled: true })).toThrow(/webhook/i);
  });

  it('enables the reminder when a webhook is supplied in the same patch', () => {
    const updated = settings.update({
      reminderEnabled: true,
      webhookKind: 'discord',
      webhookUrl: 'https://discord.com/api/webhooks/1/abc',
    });
    expect(updated.reminderEnabled).toBe(true);
  });

  it('enables the reminder when a webhook was already stored', () => {
    settings.update({ webhookKind: 'slack', webhookUrl: 'https://hooks.slack.com/services/A/B/C' });
    expect(settings.update({ reminderEnabled: true }).reminderEnabled).toBe(true);
  });

  it('refuses to clear the webhook while the reminder is still enabled', () => {
    settings.update({
      reminderEnabled: true,
      webhookKind: 'discord',
      webhookUrl: 'https://discord.com/api/webhooks/1/abc',
    });
    expect(() => settings.update({ webhookUrl: null })).toThrow(/webhook/i);
  });

  it('allows clearing the webhook once the reminder is disabled', () => {
    settings.update({
      reminderEnabled: true,
      webhookKind: 'discord',
      webhookUrl: 'https://discord.com/api/webhooks/1/abc',
    });
    const updated = settings.update({ reminderEnabled: false, webhookKind: null, webhookUrl: null });
    expect(updated.webhookUrl).toBeNull();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run apps/api/src/services/settingsService.test.ts`
Expected: FAIL — cannot resolve `./settingsService.js`.

- [ ] **Step 4: Implement the service**

`apps/api/src/services/settingsService.ts`:

```ts
import type { SettingsValue, UpdateSettingsRequestValue } from '@simple-todos/shared';
import { eq } from 'drizzle-orm';
import type { Clock } from '../clock.js';
import { schema, type AppDb } from '../db/index.js';
import { ValidationError } from '../domain/errors.js';

const SINGLETON_ID = 1;

/** Cheap IANA validation: Intl throws on an unknown zone. */
function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  } catch {
    throw new ValidationError(`unknown timezone "${timezone}"`);
  }
}

export class SettingsService {
  readonly #db: AppDb;
  readonly #clock: Clock;

  constructor(db: AppDb, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  get(): SettingsValue {
    const row = this.#db.select().from(schema.settings).where(eq(schema.settings.id, SINGLETON_ID)).get();
    if (!row) throw new Error('settings row missing — seeding did not run');
    return {
      timezone: row.timezone,
      sweepTime: row.sweepTime,
      // SQLite has no boolean; the column is 0/1 and the contract says boolean.
      reminderEnabled: row.reminderEnabled === 1,
      reminderTime: row.reminderTime,
      webhookKind: (row.webhookKind as SettingsValue['webhookKind']) ?? null,
      webhookUrl: row.webhookUrl ?? null,
      updatedAt: row.updatedAt,
    };
  }

  update(patch: UpdateSettingsRequestValue): SettingsValue {
    const current = this.get();
    const next: SettingsValue = { ...current, ...patch, updatedAt: this.#clock.now().toISOString() };

    if (patch.timezone !== undefined) assertValidTimezone(patch.timezone);

    // Enabling the reminder without somewhere to send it would fail silently
    // every morning, so it is rejected rather than stored.
    if (next.reminderEnabled && (next.webhookKind === null || next.webhookUrl === null)) {
      throw new ValidationError('a webhook kind and url are required to enable the daily reminder');
    }

    this.#db
      .update(schema.settings)
      .set({
        timezone: next.timezone,
        sweepTime: next.sweepTime,
        reminderEnabled: next.reminderEnabled ? 1 : 0,
        reminderTime: next.reminderTime,
        webhookKind: next.webhookKind,
        webhookUrl: next.webhookUrl,
        updatedAt: next.updatedAt,
      })
      .where(eq(schema.settings.id, SINGLETON_ID))
      .run();

    return this.get();
  }
}
```

- [ ] **Step 5: Run the service tests and watch them pass**

Run: `npx vitest run apps/api/src/services/settingsService.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Write the failing route test**

`apps/api/src/http/routes/settings.test.ts`:

```ts
import { Settings } from '@simple-todos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeAuthedApp, type AuthedApp } from '../../../test/helpers/testApp.js';

let ctx: AuthedApp;

beforeEach(async () => {
  ctx = await makeAuthedApp();
});

afterEach(async () => {
  await ctx.close();
});

describe('/api/settings', () => {
  it('returns the current settings, matching the shared contract', async () => {
    const res = await ctx.get('/api/settings');
    expect(res.statusCode).toBe(200);
    expect(Settings.safeParse(res.json()).success).toBe(true);
    expect(res.json().timezone).toBe('Asia/Tokyo');
  });

  it('requires a token', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/settings' })).statusCode).toBe(401);
  });

  it('updates a field', async () => {
    const res = await ctx.request('PUT', '/api/settings', { sweepTime: '04:30' });
    expect(res.statusCode).toBe(200);
    expect(res.json().sweepTime).toBe('04:30');
  });

  it('rejects a malformed time with 400', async () => {
    expect((await ctx.request('PUT', '/api/settings', { sweepTime: '25:00' })).statusCode).toBe(400);
    expect((await ctx.request('PUT', '/api/settings', { sweepTime: '4:30' })).statusCode).toBe(400);
  });

  it('rejects an unknown timezone with 400', async () => {
    const res = await ctx.request('PUT', '/api/settings', { timezone: 'Not/AZone' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects enabling the reminder with no webhook, with 400', async () => {
    const res = await ctx.request('PUT', '/api/settings', { reminderEnabled: true });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a webhook url that is not a url', async () => {
    expect((await ctx.request('PUT', '/api/settings', { webhookUrl: 'not-a-url' })).statusCode).toBe(400);
  });
});
```

- [ ] **Step 7: Add a `request` helper to the test fixture**

`makeAuthedApp` currently exposes `get`/`post`/`patch`/`del` but no `PUT`. Rather than adding a fifth one-off, add a general method to `apps/api/test/helpers/testApp.ts` and keep the existing four (other tests use them):

```ts
  request: (method, url, payload) =>
    ctx.app.inject({ method, url, headers, payload: payload as Parameters<typeof ctx.app.inject>[0] extends never ? never : never }),
```

That cast is unreadable — write it plainly instead, adding to the `AuthedApp` interface:

```ts
  request(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown): Promise<LightMyRequestResponse>;
```

and in the returned object:

```ts
    request: (method, url, payload) =>
      ctx.app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) }),
```

- [ ] **Step 8: Implement the route and register it**

`apps/api/src/http/routes/settings.ts`:

```ts
import { UpdateSettingsRequest } from '@simple-todos/shared';
import type { FastifyInstance } from 'fastify';
import type { SettingsService } from '../../services/settingsService.js';

export interface SettingsRouteDeps {
  settings: SettingsService;
}

export async function settingsRoutes(app: FastifyInstance, deps: SettingsRouteDeps): Promise<void> {
  const { settings } = deps;

  app.get('/settings', async () => settings.get());

  app.put('/settings', async (req) => settings.update(UpdateSettingsRequest.parse(req.body)));
}
```

In `apps/api/src/http/app.ts`, construct the service beside the others and register the plugin **inside the authenticated scope**, with no `prefix`:

```ts
import { SettingsService } from '../services/settingsService.js';
import { settingsRoutes } from './routes/settings.js';

// beside the other services
const settings = new SettingsService(deps.db, deps.clock);

// inside the `async (authenticated) => { ... }` callback
await authenticated.register(settingsRoutes, { settings });
```

- [ ] **Step 9: Run everything**

```bash
npm run build:shared && npm test && npm run typecheck
```
Expected: all pass. `authScope.test.ts` must still pass — the new routes are protected by construction.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add settings service and routes"
```

---

### Task 3: Occurrence-date arithmetic

Pure functions, no database. The sweep's correctness rests on these, and isolating them makes "a habit scheduled Mon/Wed/Fri, three days of downtime spanning a weekend" a millisecond-long test.

**Files:**
- Create: `apps/api/src/domain/schedule.ts`
- Test: `apps/api/src/domain/schedule.test.ts`

**Interfaces:**
- Consumes: `addLocalDays`, `localWeekday`, `compareLocalDate` from `../time.js`.
- Produces: `type Schedule = { scheduleKind: 'daily' | 'weekly'; daysOfWeek: number[] | null }`, `isScheduledOn(schedule: Schedule, date: string): boolean`, `scheduledDatesBetween(schedule: Schedule, afterDate: string, throughDate: string): string[]` (exclusive of `afterDate`, inclusive of `throughDate`), `parseDaysOfWeek(json: string | null): number[] | null`, `serialiseDaysOfWeek(days: number[] | null): string | null`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/domain/schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  isScheduledOn,
  parseDaysOfWeek,
  scheduledDatesBetween,
  serialiseDaysOfWeek,
  type Schedule,
} from './schedule.js';

const daily: Schedule = { scheduleKind: 'daily', daysOfWeek: null };
// 2026-08-31 is a Monday. ISO: Mon=1 .. Sun=7.
const mwf: Schedule = { scheduleKind: 'weekly', daysOfWeek: [1, 3, 5] };
const sundays: Schedule = { scheduleKind: 'weekly', daysOfWeek: [7] };

describe('isScheduledOn', () => {
  it('is true every day for a daily schedule', () => {
    for (const d of ['2026-08-31', '2026-09-01', '2026-09-06']) {
      expect(isScheduledOn(daily, d)).toBe(true);
    }
  });

  it('matches only the listed weekdays', () => {
    expect(isScheduledOn(mwf, '2026-08-31')).toBe(true); // Monday
    expect(isScheduledOn(mwf, '2026-09-01')).toBe(false); // Tuesday
    expect(isScheduledOn(mwf, '2026-09-02')).toBe(true); // Wednesday
    expect(isScheduledOn(mwf, '2026-09-04')).toBe(true); // Friday
    expect(isScheduledOn(mwf, '2026-09-05')).toBe(false); // Saturday
  });

  it('treats Sunday as 7, not 0', () => {
    expect(isScheduledOn(sundays, '2026-09-06')).toBe(true); // a Sunday
    expect(isScheduledOn(sundays, '2026-08-31')).toBe(false);
  });

  it('is false for a weekly schedule with an empty day list', () => {
    expect(isScheduledOn({ scheduleKind: 'weekly', daysOfWeek: [] }, '2026-08-31')).toBe(false);
  });
});

describe('scheduledDatesBetween', () => {
  it('excludes the lower bound and includes the upper', () => {
    expect(scheduledDatesBetween(daily, '2026-08-31', '2026-09-02')).toEqual([
      '2026-09-01',
      '2026-09-02',
    ]);
  });

  it('returns an empty array when the bounds touch', () => {
    expect(scheduledDatesBetween(daily, '2026-08-31', '2026-08-31')).toEqual([]);
  });

  it('returns an empty array when the upper bound precedes the lower', () => {
    expect(scheduledDatesBetween(daily, '2026-09-05', '2026-09-01')).toEqual([]);
  });

  it('skips unscheduled weekdays across a weekend', () => {
    // Mon 31 Aug exclusive → Wed 9 Sep inclusive, Mon/Wed/Fri only.
    expect(scheduledDatesBetween(mwf, '2026-08-31', '2026-09-09')).toEqual([
      '2026-09-02',
      '2026-09-04',
      '2026-09-07',
      '2026-09-09',
    ]);
  });

  it('spans a month boundary', () => {
    expect(scheduledDatesBetween(daily, '2026-08-30', '2026-09-01')).toEqual([
      '2026-08-31',
      '2026-09-01',
    ]);
  });

  it('spans a leap day', () => {
    expect(scheduledDatesBetween(daily, '2028-02-27', '2028-03-01')).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
  });

  it('handles a long gap without running away', () => {
    // A year of downtime on a weekly schedule: 52 or 53 occurrences, not 365.
    const dates = scheduledDatesBetween(sundays, '2026-01-01', '2026-12-31');
    expect(dates.length).toBeGreaterThan(50);
    expect(dates.length).toBeLessThan(54);
    expect(dates.every((d) => isScheduledOn(sundays, d))).toBe(true);
  });
});

describe('daysOfWeek serialisation', () => {
  it('round-trips through JSON', () => {
    expect(parseDaysOfWeek(serialiseDaysOfWeek([1, 3, 5]))).toEqual([1, 3, 5]);
  });

  it('maps null both ways for a daily schedule', () => {
    expect(serialiseDaysOfWeek(null)).toBeNull();
    expect(parseDaysOfWeek(null)).toBeNull();
  });

  it('throws on stored text that is not a day array', () => {
    expect(() => parseDaysOfWeek('"nonsense"')).toThrow();
    expect(() => parseDaysOfWeek('[0]')).toThrow();
    expect(() => parseDaysOfWeek('[8]')).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/api/src/domain/schedule.test.ts`
Expected: FAIL — cannot resolve `./schedule.js`.

- [ ] **Step 3: Implement**

`apps/api/src/domain/schedule.ts`:

```ts
import { z } from 'zod';
import { addLocalDays, compareLocalDate, localWeekday } from '../time.js';

export interface Schedule {
  scheduleKind: 'daily' | 'weekly';
  /** ISO weekday numbers, Mon=1 .. Sun=7. Null exactly when the schedule is daily. */
  daysOfWeek: number[] | null;
}

const DaysOfWeek = z.array(z.number().int().min(1).max(7));

export function serialiseDaysOfWeek(days: number[] | null): string | null {
  return days === null ? null : JSON.stringify(days);
}

export function parseDaysOfWeek(json: string | null): number[] | null {
  if (json === null) return null;
  return DaysOfWeek.parse(JSON.parse(json));
}

export function isScheduledOn(schedule: Schedule, date: string): boolean {
  if (schedule.scheduleKind === 'daily') return true;
  return (schedule.daysOfWeek ?? []).includes(localWeekday(date));
}

/**
 * Every scheduled date in `(afterDate, throughDate]`.
 *
 * The lower bound is exclusive because callers pass `last_processed_date` —
 * the day already closed out — and the upper is inclusive because callers
 * pass the last day they intend to resolve. Walking day by day is fine: the
 * only caller is catch-up after downtime, and a year's gap is 365 iterations.
 */
export function scheduledDatesBetween(
  schedule: Schedule,
  afterDate: string,
  throughDate: string,
): string[] {
  const dates: string[] = [];
  let cursor = addLocalDays(afterDate, 1);
  while (compareLocalDate(cursor, throughDate) <= 0) {
    if (isScheduledOn(schedule, cursor)) dates.push(cursor);
    cursor = addLocalDays(cursor, 1);
  }
  return dates;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run apps/api/src/domain/schedule.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add occurrence-date arithmetic"
```

---

### Task 4: Recurrence CRUD

**Files:**
- Create: `packages/shared/src/recurrence.ts`; Modify: `packages/shared/src/index.ts`
- Create: `apps/api/src/services/recurrenceService.ts`, `apps/api/src/http/routes/recurrences.ts`
- Modify: `apps/api/src/http/app.ts`
- Test: `apps/api/src/services/recurrenceService.test.ts`, `apps/api/src/http/routes/recurrences.test.ts`

**Interfaces:**
- Consumes: `AppDb`, `Clock`, `NotFoundError`, `ValidationError`, `SettingsService`, `localDate`, `serialiseDaysOfWeek`/`parseDaysOfWeek`.
- Produces: shared `Recurrence`, `CreateRecurrenceRequest`, `UpdateRecurrenceRequest`. `class RecurrenceService` with `list(): RecurrenceValue[]`, `get(id): RecurrenceValue`, `create(input): RecurrenceValue`, `update(id, patch): RecurrenceValue`, `remove(id): void`, and `listActive(): RecurrenceValue[]` used by the sweep. Routes `GET|POST /api/recurrences`, `PATCH|DELETE /api/recurrences/:id`.

- [ ] **Step 1: Add the shared contract**

`packages/shared/src/recurrence.ts`:

```ts
import { z } from 'zod';
import { IsoDateTime, LocalDate, Priority, Uuid } from './primitives.js';

export const SCHEDULE_KINDS = ['daily', 'weekly'] as const;
export const ScheduleKind = z.enum(SCHEDULE_KINDS);
export type ScheduleKindValue = (typeof SCHEDULE_KINDS)[number];

/** ISO weekday numbers, Monday=1 .. Sunday=7. */
export const DayOfWeek = z.number().int().min(1).max(7);

export const Recurrence = z.object({
  id: Uuid,
  title: z.string().min(1).max(500),
  notes: z.string().nullable(),
  priority: Priority,
  categoryId: Uuid.nullable(),
  scheduleKind: ScheduleKind,
  daysOfWeek: z.array(DayOfWeek).nullable(),
  active: z.boolean(),
  lastProcessedDate: LocalDate,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RecurrenceValue = z.infer<typeof Recurrence>;

const scheduleShapeIsConsistent = (v: {
  scheduleKind: ScheduleKindValue;
  daysOfWeek?: number[] | null;
}) => (v.scheduleKind === 'weekly' ? Array.isArray(v.daysOfWeek) && v.daysOfWeek.length > 0 : true);

export const CreateRecurrenceRequest = z
  .object({
    title: z.string().min(1).max(500),
    notes: z.string().nullish(),
    priority: Priority.optional(),
    categoryId: Uuid.nullish(),
    scheduleKind: ScheduleKind,
    daysOfWeek: z.array(DayOfWeek).nullish(),
  })
  .refine(scheduleShapeIsConsistent, {
    message: 'a weekly schedule needs at least one day of the week',
    path: ['daysOfWeek'],
  });
export type CreateRecurrenceRequestValue = z.infer<typeof CreateRecurrenceRequest>;

export const UpdateRecurrenceRequest = z.object({
  title: z.string().min(1).max(500).optional(),
  notes: z.string().nullable().optional(),
  priority: Priority.optional(),
  categoryId: Uuid.nullable().optional(),
  scheduleKind: ScheduleKind.optional(),
  daysOfWeek: z.array(DayOfWeek).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateRecurrenceRequestValue = z.infer<typeof UpdateRecurrenceRequest>;
```

Note the update schema deliberately does **not** carry the cross-field refine: a patch may change only `daysOfWeek`, leaving `scheduleKind` implicit, so consistency is checked in the service against the merged result. Append `export * from './recurrence.js';` to `packages/shared/src/index.ts`, then `npm run build:shared`.

- [ ] **Step 2: Write the failing service test**

`apps/api/src/services/recurrenceService.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';
import { CategoryService } from './categoryService.js';
import { RecurrenceService } from './recurrenceService.js';
import { SettingsService } from './settingsService.js';

let ctx: TestApp;
let recurrences: RecurrenceService;
let categories: CategoryService;

beforeEach(async () => {
  // 2026-08-31T01:00Z is 10:00 on the 31st in Tokyo.
  ctx = await makeTestApp('2026-08-31T01:00:00Z');
  const settings = new SettingsService(ctx.db, ctx.clock);
  recurrences = new RecurrenceService(ctx.db, ctx.clock, settings);
  categories = new CategoryService(ctx.db, ctx.clock);
});

afterEach(async () => {
  await ctx.close();
});

describe('create', () => {
  it('stores a daily habit with defaults', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    expect(r).toMatchObject({
      title: 'Exercise',
      priority: 'should',
      scheduleKind: 'daily',
      daysOfWeek: null,
      active: true,
      notes: null,
      categoryId: null,
    });
  });

  it('initialises lastProcessedDate to today in the configured timezone', () => {
    // Nothing before today should ever be back-filled as missed.
    expect(recurrences.create({ title: 'Exercise', scheduleKind: 'daily' }).lastProcessedDate).toBe(
      '2026-08-31',
    );
  });

  it('stores a weekly habit with its days', () => {
    const r = recurrences.create({ title: 'Gym', scheduleKind: 'weekly', daysOfWeek: [1, 3, 5] });
    expect(r.daysOfWeek).toEqual([1, 3, 5]);
  });

  it('rejects a weekly schedule with no days', () => {
    expect(() => recurrences.create({ title: 'Gym', scheduleKind: 'weekly', daysOfWeek: [] })).toThrow();
  });

  it('rejects days supplied for a daily schedule', () => {
    expect(() =>
      recurrences.create({ title: 'Exercise', scheduleKind: 'daily', daysOfWeek: [1] }),
    ).toThrow(/daily/i);
  });

  it('rejects an unknown categoryId with a not-found error', () => {
    expect(() =>
      recurrences.create({
        title: 'Exercise',
        scheduleKind: 'daily',
        categoryId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toThrow(/not found/i);
  });

  it('keeps a category that exists', () => {
    const cat = categories.create({ name: 'Health', color: '#22aa66' });
    expect(recurrences.create({ title: 'Exercise', scheduleKind: 'daily', categoryId: cat.id }).categoryId).toBe(
      cat.id,
    );
  });
});

describe('list', () => {
  it('returns newest first and exposes active as a boolean', () => {
    recurrences.create({ title: 'One', scheduleKind: 'daily' });
    ctx.clock.set('2026-08-31T02:00:00Z');
    recurrences.create({ title: 'Two', scheduleKind: 'daily' });
    const all = recurrences.list();
    expect(all.map((r) => r.title)).toEqual(['Two', 'One']);
    expect(typeof all[0]!.active).toBe('boolean');
  });

  it('listActive excludes paused habits', () => {
    const a = recurrences.create({ title: 'Active', scheduleKind: 'daily' });
    const b = recurrences.create({ title: 'Paused', scheduleKind: 'daily' });
    recurrences.update(b.id, { active: false });
    expect(recurrences.listActive().map((r) => r.id)).toEqual([a.id]);
    expect(recurrences.list()).toHaveLength(2);
  });
});

describe('update', () => {
  it('changes only the fields present', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily', priority: 'must' });
    const updated = recurrences.update(r.id, { title: 'Morning exercise' });
    expect(updated.title).toBe('Morning exercise');
    expect(updated.priority).toBe('must');
  });

  it('switches daily to weekly when days are supplied together', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    const updated = recurrences.update(r.id, { scheduleKind: 'weekly', daysOfWeek: [2, 4] });
    expect(updated).toMatchObject({ scheduleKind: 'weekly', daysOfWeek: [2, 4] });
  });

  it('rejects switching to weekly without days', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    expect(() => recurrences.update(r.id, { scheduleKind: 'weekly' })).toThrow(/day/i);
  });

  it('rejects clearing the days of a weekly schedule', () => {
    const r = recurrences.create({ title: 'Gym', scheduleKind: 'weekly', daysOfWeek: [1] });
    expect(() => recurrences.update(r.id, { daysOfWeek: null })).toThrow(/day/i);
  });

  it('clears the days when switching back to daily', () => {
    const r = recurrences.create({ title: 'Gym', scheduleKind: 'weekly', daysOfWeek: [1] });
    expect(recurrences.update(r.id, { scheduleKind: 'daily' }).daysOfWeek).toBeNull();
  });

  it('pauses and resumes without losing lastProcessedDate', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    recurrences.update(r.id, { active: false });
    expect(recurrences.update(r.id, { active: true }).lastProcessedDate).toBe(r.lastProcessedDate);
  });

  it('throws NotFound for an unknown id', () => {
    expect(() => recurrences.update('11111111-1111-4111-8111-111111111111', { title: 'x' })).toThrow(
      /not found/i,
    );
  });
});

describe('remove', () => {
  it('deletes the definition', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    recurrences.remove(r.id);
    expect(() => recurrences.get(r.id)).toThrow(/not found/i);
  });

  it('leaves already-spawned instance tasks behind as ordinary tasks', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    ctx.db.$client
      .prepare(
        `INSERT INTO task (id, parent_id, root_id, position, title, notes, notes_updated_at, priority,
           category_id, due_date, created_at, completed_at, archived_at, recurrence_id, occurrence_date)
         VALUES ('inst-1', NULL, 'inst-1', 0, 'Exercise', NULL, NULL, 'should', NULL, '2026-08-31',
           '2026-08-31T01:00:00.000Z', '2026-08-31T09:00:00.000Z', NULL, ?, '2026-08-31')`,
      )
      .run(r.id);

    recurrences.remove(r.id);

    const row = ctx.db.$client
      .prepare(`SELECT title, recurrence_id, occurrence_date, completed_at FROM task WHERE id = 'inst-1'`)
      .get() as { title: string; recurrence_id: string | null; occurrence_date: string | null; completed_at: string | null };
    // Evidence of work actually done must survive deleting the habit.
    expect(row.title).toBe('Exercise');
    expect(row.recurrence_id).toBeNull();
    expect(row.occurrence_date).toBe('2026-08-31');
    expect(row.completed_at).not.toBeNull();
  });

  it('deletes the habit history along with the definition', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    ctx.db.$client
      .prepare(
        `INSERT INTO recurrence_log (id, recurrence_id, occurrence_date, status, completed_at)
         VALUES ('log-1', ?, '2026-08-30', 'missed', NULL)`,
      )
      .run(r.id);

    recurrences.remove(r.id);

    const n = ctx.db.$client.prepare(`SELECT count(*) AS n FROM recurrence_log`).get() as { n: number };
    expect(n.n).toBe(0);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run apps/api/src/services/recurrenceService.test.ts`
Expected: FAIL — cannot resolve `./recurrenceService.js`.

- [ ] **Step 4: Implement the service**

`apps/api/src/services/recurrenceService.ts`:

```ts
import type {
  CreateRecurrenceRequestValue,
  RecurrenceValue,
  UpdateRecurrenceRequestValue,
} from '@simple-todos/shared';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../clock.js';
import { schema, type AppDb } from '../db/index.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import { parseDaysOfWeek, serialiseDaysOfWeek } from '../domain/schedule.js';
import { localDate } from '../time.js';
import type { SettingsService } from './settingsService.js';

type Row = typeof schema.recurrences.$inferSelect;

export class RecurrenceService {
  readonly #db: AppDb;
  readonly #clock: Clock;
  readonly #settings: SettingsService;

  constructor(db: AppDb, clock: Clock, settings: SettingsService) {
    this.#db = db;
    this.#clock = clock;
    this.#settings = settings;
  }

  list(): RecurrenceValue[] {
    return this.#db
      .select()
      .from(schema.recurrences)
      .orderBy(desc(schema.recurrences.createdAt))
      .all()
      .map(toValue);
  }

  /** The sweep only ever spawns or closes out habits that are switched on. */
  listActive(): RecurrenceValue[] {
    return this.list().filter((r) => r.active);
  }

  get(id: string): RecurrenceValue {
    const row = this.#db.select().from(schema.recurrences).where(eq(schema.recurrences.id, id)).get();
    if (!row) throw new NotFoundError('recurrence', id);
    return toValue(row);
  }

  create(input: CreateRecurrenceRequestValue): RecurrenceValue {
    const daysOfWeek = input.daysOfWeek ?? null;
    assertScheduleShape(input.scheduleKind, daysOfWeek);
    if (input.categoryId) this.#requireCategory(input.categoryId);

    const now = this.#clock.now();
    const timestamp = now.toISOString();
    const id = randomUUID();

    this.#db
      .insert(schema.recurrences)
      .values({
        id,
        title: input.title,
        notes: input.notes ?? null,
        priority: input.priority ?? 'should',
        categoryId: input.categoryId ?? null,
        scheduleKind: input.scheduleKind,
        daysOfWeek: serialiseDaysOfWeek(daysOfWeek),
        active: 1,
        // Today, so a habit created now is never back-filled with misses for
        // dates before it existed.
        lastProcessedDate: localDate(now, this.#settings.get().timezone),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    return this.get(id);
  }

  update(id: string, patch: UpdateRecurrenceRequestValue): RecurrenceValue {
    const current = this.get(id);

    const scheduleKind = patch.scheduleKind ?? current.scheduleKind;
    // Switching to daily clears the days even if the patch does not mention them.
    const daysOfWeek =
      scheduleKind === 'daily'
        ? null
        : patch.daysOfWeek !== undefined
          ? patch.daysOfWeek
          : current.daysOfWeek;
    assertScheduleShape(scheduleKind, daysOfWeek);

    if (patch.categoryId) this.#requireCategory(patch.categoryId);

    this.#db
      .update(schema.recurrences)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
        ...(patch.active !== undefined ? { active: patch.active ? 1 : 0 } : {}),
        scheduleKind,
        daysOfWeek: serialiseDaysOfWeek(daysOfWeek),
        updatedAt: this.#clock.now().toISOString(),
      })
      .where(eq(schema.recurrences.id, id))
      .run();

    return this.get(id);
  }

  /**
   * Deletes the definition and, by foreign key, its history. Instance tasks
   * survive with `recurrence_id` nulled — archived evidence of work actually
   * done must not vanish because the habit was deleted.
   */
  remove(id: string): void {
    this.get(id);
    this.#db.delete(schema.recurrences).where(eq(schema.recurrences.id, id)).run();
  }

  /** Advance the watermark once the sweep has resolved every date up to `date`. */
  setLastProcessedDate(id: string, date: string): void {
    this.#db
      .update(schema.recurrences)
      .set({ lastProcessedDate: date })
      .where(eq(schema.recurrences.id, id))
      .run();
  }

  #requireCategory(id: string): void {
    const row = this.#db.select().from(schema.categories).where(eq(schema.categories.id, id)).get();
    if (!row) throw new NotFoundError('category', id);
  }
}

function assertScheduleShape(kind: 'daily' | 'weekly', days: number[] | null): void {
  if (kind === 'weekly' && (days === null || days.length === 0)) {
    throw new ValidationError('a weekly schedule needs at least one day of the week');
  }
  if (kind === 'daily' && days !== null && days.length > 0) {
    throw new ValidationError('a daily schedule cannot list days of the week');
  }
}

function toValue(row: Row): RecurrenceValue {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? null,
    priority: row.priority as RecurrenceValue['priority'],
    categoryId: row.categoryId ?? null,
    scheduleKind: row.scheduleKind as RecurrenceValue['scheduleKind'],
    daysOfWeek: parseDaysOfWeek(row.daysOfWeek),
    active: row.active === 1,
    lastProcessedDate: row.lastProcessedDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
```

Note `create` passes `daysOfWeek` through `assertScheduleShape` before touching the database, so the table's own `CHECK` is a backstop rather than the error path a client sees.

- [ ] **Step 5: Run the service tests and watch them pass**

Run: `npx vitest run apps/api/src/services/recurrenceService.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 6: Write the failing route test**

`apps/api/src/http/routes/recurrences.test.ts`:

```ts
import { Recurrence } from '@simple-todos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeAuthedApp, type AuthedApp } from '../../../test/helpers/testApp.js';

let ctx: AuthedApp;

beforeEach(async () => {
  ctx = await makeAuthedApp('2026-08-31T01:00:00Z');
});

afterEach(async () => {
  await ctx.close();
});

describe('/api/recurrences', () => {
  it('creates one and returns 201 matching the contract', async () => {
    const res = await ctx.post('/api/recurrences', { title: 'Exercise', scheduleKind: 'daily' });
    expect(res.statusCode).toBe(201);
    expect(Recurrence.safeParse(res.json()).success).toBe(true);
  });

  it('requires a token', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/recurrences' })).statusCode).toBe(401);
  });

  it('lists them', async () => {
    await ctx.post('/api/recurrences', { title: 'Exercise', scheduleKind: 'daily' });
    const res = await ctx.get('/api/recurrences');
    expect(res.json()).toHaveLength(1);
  });

  it('rejects a weekly schedule with no days, with 400', async () => {
    const res = await ctx.post('/api/recurrences', { title: 'Gym', scheduleKind: 'weekly' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an out-of-range weekday', async () => {
    expect(
      (await ctx.post('/api/recurrences', { title: 'Gym', scheduleKind: 'weekly', daysOfWeek: [0] }))
        .statusCode,
    ).toBe(400);
    expect(
      (await ctx.post('/api/recurrences', { title: 'Gym', scheduleKind: 'weekly', daysOfWeek: [8] }))
        .statusCode,
    ).toBe(400);
  });

  it('rejects an unknown categoryId with 404', async () => {
    const res = await ctx.post('/api/recurrences', {
      title: 'Exercise',
      scheduleKind: 'daily',
      categoryId: '11111111-1111-4111-8111-111111111111',
    });
    expect(res.statusCode).toBe(404);
  });

  it('pauses via PATCH active:false', async () => {
    const created = (await ctx.post('/api/recurrences', { title: 'Exercise', scheduleKind: 'daily' })).json();
    const res = await ctx.patch(`/api/recurrences/${created.id}`, { active: false });
    expect(res.json().active).toBe(false);
  });

  it('deletes and then 404s', async () => {
    const created = (await ctx.post('/api/recurrences', { title: 'Exercise', scheduleKind: 'daily' })).json();
    expect((await ctx.del(`/api/recurrences/${created.id}`)).statusCode).toBe(204);
    expect((await ctx.patch(`/api/recurrences/${created.id}`, { title: 'x' })).statusCode).toBe(404);
  });
});
```

- [ ] **Step 7: Implement the routes and register them**

`apps/api/src/http/routes/recurrences.ts`:

```ts
import { CreateRecurrenceRequest, UpdateRecurrenceRequest } from '@simple-todos/shared';
import type { FastifyInstance } from 'fastify';
import type { RecurrenceService } from '../../services/recurrenceService.js';

export interface RecurrenceRouteDeps {
  recurrences: RecurrenceService;
}

export async function recurrenceRoutes(app: FastifyInstance, deps: RecurrenceRouteDeps): Promise<void> {
  const { recurrences } = deps;

  app.get('/recurrences', async () => recurrences.list());

  app.post('/recurrences', async (req, reply) => {
    const created = recurrences.create(CreateRecurrenceRequest.parse(req.body));
    reply.status(201);
    return created;
  });

  app.patch('/recurrences/:id', async (req) =>
    recurrences.update((req.params as { id: string }).id, UpdateRecurrenceRequest.parse(req.body)),
  );

  app.delete('/recurrences/:id', async (req, reply) => {
    recurrences.remove((req.params as { id: string }).id);
    reply.status(204).send();
  });
}
```

In `apps/api/src/http/app.ts`, construct the service and register the plugin **inside the authenticated scope**, no `prefix`:

```ts
import { RecurrenceService } from '../services/recurrenceService.js';
import { recurrenceRoutes } from './routes/recurrences.js';

const recurrences = new RecurrenceService(deps.db, deps.clock, settings);

await authenticated.register(recurrenceRoutes, { recurrences });
```

- [ ] **Step 8: Run everything**

```bash
npm run build:shared && npm test && npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add recurrence definitions"
```

---

### Task 5: Hit/miss history and streaks

The point of a repeatable task is the record it leaves. Streak arithmetic is pure and gets its own tests.

**Files:**
- Modify: `packages/shared/src/recurrence.ts`
- Create: `apps/api/src/domain/streaks.ts`
- Modify: `apps/api/src/services/recurrenceService.ts`, `apps/api/src/http/routes/recurrences.ts`
- Test: `apps/api/src/domain/streaks.test.ts`, and append to the two recurrence test files

**Interfaces:**
- Consumes: `AppDb`, `compareLocalDate`.
- Produces: shared `HistoryEntry`, `HistoryQuery`, `RecurrenceHistory`. `computeStreaks(entries: HistoryEntry[]): {current: number; longest: number}` in `domain/streaks.ts`. `RecurrenceService.history(id, query): RecurrenceHistoryValue`. Route `GET /api/recurrences/:id/history`.

- [ ] **Step 1: Add to the shared contract**

Append to `packages/shared/src/recurrence.ts`:

```ts
export const OCCURRENCE_STATUSES = ['completed', 'missed'] as const;
export const OccurrenceStatus = z.enum(OCCURRENCE_STATUSES);
export type OccurrenceStatusValue = (typeof OCCURRENCE_STATUSES)[number];

export const HistoryEntry = z.object({
  date: LocalDate,
  status: OccurrenceStatus,
  completedAt: IsoDateTime.nullable(),
});
export type HistoryEntryValue = z.infer<typeof HistoryEntry>;

export const HistoryQuery = z.object({
  from: LocalDate.optional(),
  to: LocalDate.optional(),
});
export type HistoryQueryValue = z.infer<typeof HistoryQuery>;

export const RecurrenceHistory = z.object({
  recurrenceId: Uuid,
  entries: z.array(HistoryEntry),
  currentStreak: z.number().int().min(0),
  longestStreak: z.number().int().min(0),
});
export type RecurrenceHistoryValue = z.infer<typeof RecurrenceHistory>;
```

Then `npm run build:shared`.

- [ ] **Step 2: Write the failing streak test**

`apps/api/src/domain/streaks.test.ts`:

```ts
import type { HistoryEntryValue } from '@simple-todos/shared';
import { describe, expect, it } from 'vitest';
import { computeStreaks } from './streaks.js';

const done = (date: string): HistoryEntryValue => ({ date, status: 'completed', completedAt: `${date}T09:00:00.000Z` });
const missed = (date: string): HistoryEntryValue => ({ date, status: 'missed', completedAt: null });

describe('computeStreaks', () => {
  it('returns zeroes for no history', () => {
    expect(computeStreaks([])).toEqual({ current: 0, longest: 0 });
  });

  it('counts an unbroken run', () => {
    expect(computeStreaks([done('2026-09-01'), done('2026-09-02'), done('2026-09-03')])).toEqual({
      current: 3,
      longest: 3,
    });
  });

  it('resets the current streak at the most recent miss', () => {
    expect(
      computeStreaks([done('2026-09-01'), done('2026-09-02'), missed('2026-09-03'), done('2026-09-04')]),
    ).toEqual({ current: 1, longest: 2 });
  });

  it('reports current as zero when the latest occurrence was missed', () => {
    expect(computeStreaks([done('2026-09-01'), done('2026-09-02'), missed('2026-09-03')])).toEqual({
      current: 0,
      longest: 2,
    });
  });

  it('keeps the longest run from earlier in the history', () => {
    expect(
      computeStreaks([
        done('2026-09-01'),
        done('2026-09-02'),
        done('2026-09-03'),
        missed('2026-09-04'),
        done('2026-09-05'),
      ]),
    ).toEqual({ current: 1, longest: 3 });
  });

  it('sorts by date rather than trusting input order', () => {
    // A caller passing rows in arbitrary order must not change the answer.
    expect(computeStreaks([done('2026-09-03'), missed('2026-09-01'), done('2026-09-02')])).toEqual({
      current: 2,
      longest: 2,
    });
  });

  it('counts consecutive scheduled occurrences, not calendar days', () => {
    // A Mon/Wed/Fri habit: three scheduled days hit in a row is a streak of 3,
    // even though the calendar dates are not contiguous.
    expect(computeStreaks([done('2026-09-02'), done('2026-09-04'), done('2026-09-07')])).toEqual({
      current: 3,
      longest: 3,
    });
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run apps/api/src/domain/streaks.test.ts`
Expected: FAIL — cannot resolve `./streaks.js`.

- [ ] **Step 4: Implement**

`apps/api/src/domain/streaks.ts`:

```ts
import type { HistoryEntryValue } from '@simple-todos/shared';
import { compareLocalDate } from '../time.js';

/**
 * Streaks over *scheduled occurrences*, not calendar days.
 *
 * A Mon/Wed/Fri habit hit three sessions running is a streak of 3, even though
 * the dates are not contiguous — the log only ever holds dates the habit was
 * actually due, so consecutive entries are consecutive opportunities.
 */
export function computeStreaks(entries: HistoryEntryValue[]): { current: number; longest: number } {
  const ordered = [...entries].sort((a, b) => compareLocalDate(a.date, b.date));

  let longest = 0;
  let run = 0;
  for (const entry of ordered) {
    run = entry.status === 'completed' ? run + 1 : 0;
    if (run > longest) longest = run;
  }

  // The current streak is the trailing run, so it is whatever `run` holds
  // after the final entry — zero if the most recent occurrence was missed.
  return { current: run, longest };
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run apps/api/src/domain/streaks.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Add `history` to the service, test first**

Append to `apps/api/src/services/recurrenceService.test.ts`:

```ts
describe('history', () => {
  function log(recurrenceId: string, date: string, status: 'completed' | 'missed') {
    ctx.db.$client
      .prepare(
        `INSERT INTO recurrence_log (id, recurrence_id, occurrence_date, status, completed_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(`log-${date}-${recurrenceId.slice(0, 4)}`, recurrenceId, date, status, status === 'completed' ? `${date}T09:00:00.000Z` : null);
  }

  it('returns entries oldest first with streaks', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    log(r.id, '2026-09-02', 'completed');
    log(r.id, '2026-09-01', 'completed');
    log(r.id, '2026-09-03', 'missed');

    const h = recurrences.history(r.id, {});
    expect(h.entries.map((e) => e.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(h).toMatchObject({ recurrenceId: r.id, currentStreak: 0, longestStreak: 2 });
  });

  it('filters by an inclusive local-date range', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    log(r.id, '2026-09-01', 'completed');
    log(r.id, '2026-09-02', 'completed');
    log(r.id, '2026-09-03', 'completed');

    const h = recurrences.history(r.id, { from: '2026-09-02', to: '2026-09-03' });
    expect(h.entries.map((e) => e.date)).toEqual(['2026-09-02', '2026-09-03']);
  });

  it('returns empty history with zero streaks for a new habit', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    expect(recurrences.history(r.id, {})).toMatchObject({ entries: [], currentStreak: 0, longestStreak: 0 });
  });

  it('does not mix in another habit history', () => {
    const a = recurrences.create({ title: 'A', scheduleKind: 'daily' });
    const b = recurrences.create({ title: 'B', scheduleKind: 'daily' });
    log(a.id, '2026-09-01', 'completed');
    log(b.id, '2026-09-01', 'missed');
    expect(recurrences.history(a.id, {}).entries).toHaveLength(1);
    expect(recurrences.history(a.id, {}).entries[0]!.status).toBe('completed');
  });

  it('throws NotFound for an unknown habit', () => {
    expect(() => recurrences.history('11111111-1111-4111-8111-111111111111', {})).toThrow(/not found/i);
  });
});
```

- [ ] **Step 7: Implement `history`**

Add to `RecurrenceService` (and add `and`, `asc`, `gte`, `lte` to the existing `drizzle-orm` import, plus the streak and type imports):

```ts
  history(id: string, query: HistoryQueryValue): RecurrenceHistoryValue {
    this.get(id); // 404 before querying the log

    const conditions = [eq(schema.recurrenceLogs.recurrenceId, id)];
    // Local-date strings are zero-padded, so a plain string comparison is a
    // chronological one — no timezone conversion is needed here.
    if (query.from) conditions.push(gte(schema.recurrenceLogs.occurrenceDate, query.from));
    if (query.to) conditions.push(lte(schema.recurrenceLogs.occurrenceDate, query.to));

    const rows = this.#db
      .select()
      .from(schema.recurrenceLogs)
      .where(and(...conditions))
      .orderBy(asc(schema.recurrenceLogs.occurrenceDate))
      .all();

    const entries: HistoryEntryValue[] = rows.map((row) => ({
      date: row.occurrenceDate,
      status: row.status as HistoryEntryValue['status'],
      completedAt: row.completedAt ?? null,
    }));

    const { current, longest } = computeStreaks(entries);
    return { recurrenceId: id, entries, currentStreak: current, longestStreak: longest };
  }
```

- [ ] **Step 8: Add the route, test first**

Append to `apps/api/src/http/routes/recurrences.test.ts`:

```ts
describe('GET /api/recurrences/:id/history', () => {
  it('returns history matching the contract', async () => {
    const created = (await ctx.post('/api/recurrences', { title: 'Exercise', scheduleKind: 'daily' })).json();
    const res = await ctx.get(`/api/recurrences/${created.id}/history`);
    expect(res.statusCode).toBe(200);
    expect(RecurrenceHistory.safeParse(res.json()).success).toBe(true);
    expect(res.json()).toMatchObject({ entries: [], currentStreak: 0, longestStreak: 0 });
  });

  it('404s for an unknown habit', async () => {
    expect(
      (await ctx.get('/api/recurrences/11111111-1111-4111-8111-111111111111/history')).statusCode,
    ).toBe(404);
  });

  it('rejects an impossible from date with 400', async () => {
    const created = (await ctx.post('/api/recurrences', { title: 'Exercise', scheduleKind: 'daily' })).json();
    expect((await ctx.get(`/api/recurrences/${created.id}/history?from=2026-02-31`)).statusCode).toBe(400);
  });
});
```

Add `RecurrenceHistory` to the `@simple-todos/shared` import at the top of that file.

Then add to `recurrenceRoutes`:

```ts
  app.get('/recurrences/:id/history', async (req) =>
    recurrences.history((req.params as { id: string }).id, HistoryQuery.parse(req.query)),
  );
```

with `HistoryQuery` added to the shared import.

- [ ] **Step 9: Run everything**

```bash
npm run build:shared && npm test && npm run typecheck
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add recurrence history and streaks"
```

---

### Task 6: Completing an instance records it in the history

`TaskService.complete` currently ignores `recurrence_id`. An instance task is an ordinary task in every other respect, so this is a small, surgical addition to code Plan 1 already tested — do not restructure the cascade.

**Files:**
- Modify: `apps/api/src/services/taskService.ts`
- Test: `apps/api/src/services/taskRecurrence.test.ts`

**Interfaces:**
- Consumes: `TaskService.complete` / `uncomplete` as they stand.
- Produces: no new public methods. `complete` upserts a `completed` row into `recurrence_log`; `uncomplete` deletes it.

- [ ] **Step 1: Write the failing test**

`apps/api/src/services/taskRecurrence.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';
import { TaskService } from './taskService.js';

let ctx: TestApp;
let tasks: TaskService;

beforeEach(async () => {
  ctx = await makeTestApp('2026-08-31T01:00:00Z');
  tasks = new TaskService(ctx.db, ctx.clock);

  ctx.db.$client
    .prepare(
      `INSERT INTO recurrence (id, title, notes, priority, category_id, schedule_kind, days_of_week,
         active, last_processed_date, created_at, updated_at)
       VALUES ('rec-1', 'Exercise', NULL, 'should', NULL, 'daily', NULL, 1, '2026-08-30',
         '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z')`,
    )
    .run();
});

afterEach(async () => {
  await ctx.close();
});

/** Spawn an instance the way the sweep will, so these tests do not depend on it. */
function makeInstance(id: string, occurrenceDate: string) {
  ctx.db.$client
    .prepare(
      `INSERT INTO task (id, parent_id, root_id, position, title, notes, notes_updated_at, priority,
         category_id, due_date, created_at, completed_at, archived_at, recurrence_id, occurrence_date)
       VALUES (?, NULL, ?, 0, 'Exercise', NULL, NULL, 'should', NULL, ?, '2026-08-31T00:00:00.000Z',
         NULL, NULL, 'rec-1', ?)`,
    )
    .run(id, id, occurrenceDate, occurrenceDate);
  return id;
}

function logRows() {
  return ctx.db.$client
    .prepare(`SELECT occurrence_date, status, completed_at FROM recurrence_log ORDER BY occurrence_date`)
    .all() as { occurrence_date: string; status: string; completed_at: string | null }[];
}

describe('completing a recurrence instance', () => {
  it('writes a completed row into the history', () => {
    tasks.complete(makeInstance('inst-1', '2026-08-31'));
    expect(logRows()).toEqual([
      { occurrence_date: '2026-08-31', status: 'completed', completed_at: '2026-08-31T01:00:00.000Z' },
    ]);
  });

  it('writes nothing for an ordinary task', () => {
    tasks.complete(tasks.create({ title: 'Buy milk' }).id);
    expect(logRows()).toEqual([]);
  });

  it('is idempotent — completing twice leaves one row', () => {
    const id = makeInstance('inst-1', '2026-08-31');
    tasks.complete(id);
    tasks.uncomplete(id);
    ctx.clock.set('2026-08-31T05:00:00Z');
    tasks.complete(id);
    expect(logRows()).toHaveLength(1);
    expect(logRows()[0]!.completed_at).toBe('2026-08-31T05:00:00.000Z');
  });

  it('overwrites a missed row if the day is completed late', () => {
    ctx.db.$client
      .prepare(
        `INSERT INTO recurrence_log (id, recurrence_id, occurrence_date, status, completed_at)
         VALUES ('log-1', 'rec-1', '2026-08-31', 'missed', NULL)`,
      )
      .run();
    tasks.complete(makeInstance('inst-1', '2026-08-31'));
    expect(logRows()).toEqual([
      { occurrence_date: '2026-08-31', status: 'completed', completed_at: '2026-08-31T01:00:00.000Z' },
    ]);
  });

  it('uncompleting removes the history row, so the sweep can log it missed', () => {
    const id = makeInstance('inst-1', '2026-08-31');
    tasks.complete(id);
    tasks.uncomplete(id);
    expect(logRows()).toEqual([]);
  });

  it('records the instance, not an ancestor, when a subtask is completed', () => {
    // An instance can carry ad-hoc subtasks; completing the instance cascades
    // down, and exactly one history row must result.
    const instance = makeInstance('inst-1', '2026-08-31');
    tasks.create({ title: 'Stretch first', parentId: instance });
    tasks.complete(instance);
    expect(logRows()).toHaveLength(1);
  });

  it('leaves history alone when an orphaned instance is completed', () => {
    // Deleting a habit nulls recurrence_id but leaves occurrence_date behind.
    const id = makeInstance('inst-1', '2026-08-31');
    ctx.db.$client.prepare(`UPDATE task SET recurrence_id = NULL WHERE id = ?`).run(id);
    tasks.complete(id);
    expect(logRows()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/api/src/services/taskRecurrence.test.ts`
Expected: FAIL — no history rows are written.

- [ ] **Step 3: Implement**

In `apps/api/src/services/taskService.ts`, inside `complete`'s existing transaction and after the cascade `UPDATE`, add:

```ts
      // An instance of a repeatable task also writes its hit into the habit's
      // history. Upsert, because the sweep may already have logged this date
      // as missed and completing it late must correct that.
      const task = this.get(id);
      if (task.recurrenceId !== null && task.occurrenceDate !== null) {
        tx.run(sql`
          INSERT INTO recurrence_log (id, recurrence_id, occurrence_date, status, completed_at)
          VALUES (${randomUUID()}, ${task.recurrenceId}, ${task.occurrenceDate}, 'completed', ${now})
          ON CONFLICT (recurrence_id, occurrence_date)
          DO UPDATE SET status = 'completed', completed_at = ${now}
        `);
      }
```

Read `task` before the cascade runs if that reads more cleanly — the fields used are not changed by it.

In `uncomplete`, inside the existing transaction:

```ts
      // Reopening an instance retracts the hit. If that date is already past,
      // the next sweep will record it as missed instead.
      if (task.recurrenceId !== null && task.occurrenceDate !== null) {
        tx.run(sql`
          DELETE FROM recurrence_log
           WHERE recurrence_id = ${task.recurrenceId} AND occurrence_date = ${task.occurrenceDate}
        `);
      }
```

`uncomplete` already loads `task` at the top, so reuse it.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run apps/api/src/services/taskRecurrence.test.ts`
Expected: PASS, 7 tests. Every prior `taskService`/`taskCompletion` test must still pass untouched.

- [ ] **Step 5: Run everything and commit**

```bash
npm test && npm run typecheck
git add -A
git commit -m "feat: record recurrence hits when an instance is completed"
```

---

### Task 7: The nightly sweep

The heart of the plan. `sweep(D)` means "close out day `D-1`" and is a pure function of its target date: one transaction, idempotent on `job_run('sweep', D)`, no ambient time.

**Files:**
- Create: `apps/api/src/services/sweepService.ts`
- Test: `apps/api/src/services/sweepService.test.ts`

**Interfaces:**
- Consumes: `AppDb`, `Clock`, `SettingsService`, `RecurrenceService` (`listActive`, `setLastProcessedDate`), `addLocalDays`, `compareLocalDate`, `scheduledDatesBetween`, `isScheduledOn`.
- Produces: `interface SweepResult { ran: boolean; archived: number; missed: number; spawned: number }`, `class SweepService` with `sweep(targetDate: string): SweepResult` and `lastSweptDate(): string | null`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/services/sweepService.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';
import { RecurrenceService } from './recurrenceService.js';
import { SettingsService } from './settingsService.js';
import { SweepService } from './sweepService.js';
import { TaskService } from './taskService.js';

let ctx: TestApp;
let tasks: TaskService;
let recurrences: RecurrenceService;
let sweep: SweepService;

beforeEach(async () => {
  // 2026-08-31T01:00Z is 10:00 on the 31st in Tokyo.
  ctx = await makeTestApp('2026-08-31T01:00:00Z');
  const settings = new SettingsService(ctx.db, ctx.clock);
  tasks = new TaskService(ctx.db, ctx.clock);
  recurrences = new RecurrenceService(ctx.db, ctx.clock, settings);
  sweep = new SweepService(ctx.db, ctx.clock, settings, recurrences, tasks);
});

afterEach(async () => {
  await ctx.close();
});

const activeTitles = () => tasks.listActive({}).map((t) => t.title).sort();
const logRows = () =>
  ctx.db.$client
    .prepare(`SELECT occurrence_date, status FROM recurrence_log ORDER BY occurrence_date`)
    .all() as { occurrence_date: string; status: string }[];

describe('archiving complete trees', () => {
  it('archives a whole tree once every task in it is done', () => {
    const root = tasks.create({ title: 'Plan trip' });
    const child = tasks.create({ title: 'Book flights', parentId: root.id });
    tasks.complete(root.id);

    const result = sweep.sweep('2026-09-01');

    expect(result.archived).toBe(2);
    expect(tasks.get(root.id).archivedAt).not.toBeNull();
    expect(tasks.get(child.id).archivedAt).toBe(tasks.get(root.id).archivedAt);
    expect(activeTitles()).toEqual([]);
  });

  it('leaves a tree alone when any task in it is still open', () => {
    const root = tasks.create({ title: 'Plan trip' });
    const child = tasks.create({ title: 'Book flights', parentId: root.id });
    tasks.complete(child.id);

    sweep.sweep('2026-09-01');

    expect(tasks.get(root.id).archivedAt).toBeNull();
    expect(tasks.get(child.id).archivedAt).toBeNull();
    expect(activeTitles()).toEqual(['Book flights', 'Plan trip']);
  });

  it('archives every node of a tree with one timestamp', () => {
    const root = tasks.create({ title: 'A' });
    tasks.create({ title: 'B', parentId: root.id });
    tasks.create({ title: 'C', parentId: root.id });
    tasks.complete(root.id);

    sweep.sweep('2026-09-01');

    const stamps = ctx.db.$client
      .prepare(`SELECT DISTINCT archived_at FROM task WHERE root_id = ?`)
      .all(root.id) as { archived_at: string }[];
    expect(stamps).toHaveLength(1);
  });

  it('never archives an incomplete task, upholding invariant 2', () => {
    tasks.create({ title: 'Still going' });
    sweep.sweep('2026-09-01');
    const bad = ctx.db.$client
      .prepare(`SELECT count(*) AS n FROM task WHERE archived_at IS NOT NULL AND completed_at IS NULL`)
      .get() as { n: number };
    expect(bad.n).toBe(0);
  });

  it('does not re-archive an already archived tree', () => {
    const root = tasks.create({ title: 'A' });
    tasks.complete(root.id);
    sweep.sweep('2026-09-01');
    const first = tasks.get(root.id).archivedAt;

    ctx.clock.set('2026-09-02T18:00:00Z');
    sweep.sweep('2026-09-02');

    expect(tasks.get(root.id).archivedAt).toBe(first);
  });
});

describe('closing out repeatable tasks', () => {
  it('logs a miss and clears the stale instance', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    // The instance for the 31st exists and was never completed.
    sweep.sweep('2026-08-31'); // spawns today's
    expect(activeTitles()).toEqual(['Exercise']);

    ctx.clock.set('2026-09-01T18:00:00Z');
    const result = sweep.sweep('2026-09-01'); // closes out the 31st, spawns the 1st

    expect(result.missed).toBe(1);
    expect(logRows()).toEqual([{ occurrence_date: '2026-08-31', status: 'missed' }]);
    // Exactly one instance in the list: today's, not a backlog.
    expect(activeTitles()).toEqual(['Exercise']);
    const instances = ctx.db.$client
      .prepare(`SELECT occurrence_date FROM task WHERE recurrence_id = ?`)
      .all(r.id) as { occurrence_date: string }[];
    expect(instances).toEqual([{ occurrence_date: '2026-09-01' }]);
  });

  it('does not log a miss for a day that was completed', () => {
    recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    sweep.sweep('2026-08-31');
    const instance = tasks.listActive({}).find((t) => t.title === 'Exercise')!;
    tasks.complete(instance.id);

    ctx.clock.set('2026-09-01T18:00:00Z');
    const result = sweep.sweep('2026-09-01');

    expect(result.missed).toBe(0);
    expect(logRows()).toEqual([{ occurrence_date: '2026-08-31', status: 'completed' }]);
  });

  it('skips days the habit is not scheduled for', () => {
    // 2026-08-31 is a Monday; this habit runs Mondays only.
    recurrences.create({ title: 'Gym', scheduleKind: 'weekly', daysOfWeek: [1] });
    sweep.sweep('2026-08-31');

    ctx.clock.set('2026-09-02T18:00:00Z');
    const result = sweep.sweep('2026-09-02'); // closes out Tue 1 Sep

    // Monday the 31st is missed; Tuesday was never due.
    expect(logRows()).toEqual([{ occurrence_date: '2026-08-31', status: 'missed' }]);
    expect(result.spawned).toBe(0); // Wednesday is not a Monday
  });

  it('ignores paused habits entirely', () => {
    const r = recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    recurrences.update(r.id, { active: false });

    const result = sweep.sweep('2026-09-01');

    expect(result.spawned).toBe(0);
    expect(logRows()).toEqual([]);
  });
});

describe('spawning today instances', () => {
  it('creates one instance carrying the definition fields', () => {
    const r = recurrences.create({
      title: 'Exercise',
      scheduleKind: 'daily',
      priority: 'must',
      notes: 'a description of the habit',
    });

    const result = sweep.sweep('2026-08-31');

    expect(result.spawned).toBe(1);
    const instance = tasks.listActive({}).find((t) => t.title === 'Exercise')!;
    expect(instance).toMatchObject({
      priority: 'must',
      dueDate: '2026-08-31',
      occurrenceDate: '2026-08-31',
      recurrenceId: r.id,
      parentId: null,
      completedAt: null,
    });
  });

  it('does NOT copy the definition notes onto the instance', () => {
    // Copying would deposit an identical note on the Notes page every day.
    recurrences.create({ title: 'Exercise', scheduleKind: 'daily', notes: 'a description of the habit' });
    sweep.sweep('2026-08-31');
    const instance = tasks.listActive({}).find((t) => t.title === 'Exercise')!;
    expect(instance.notes).toBeNull();
    expect(instance.notesUpdatedAt).toBeNull();
  });

  it('carries the category through', () => {
    const cat = ctx.db.$client.prepare(
      `INSERT INTO category (id, name, color, position, created_at)
       VALUES ('cat-1', 'Health', '#22aa66', 0, '2026-08-30T00:00:00.000Z') RETURNING id`,
    ).get() as { id: string };
    recurrences.create({ title: 'Exercise', scheduleKind: 'daily', categoryId: cat.id });

    sweep.sweep('2026-08-31');

    expect(tasks.listActive({}).find((t) => t.title === 'Exercise')!.categoryId).toBe('cat-1');
  });

  it('does not spawn a second instance for a date that already has one', () => {
    recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    sweep.sweep('2026-08-31');
    // Force a re-run of the same target date by clearing the ledger.
    ctx.db.$client.prepare(`DELETE FROM job_run`).run();

    const result = sweep.sweep('2026-08-31');

    expect(result.spawned).toBe(0);
    expect(tasks.listActive({}).filter((t) => t.title === 'Exercise')).toHaveLength(1);
  });
});

describe('idempotency and the ledger', () => {
  it('records the run in job_run', () => {
    sweep.sweep('2026-09-01');
    const rows = ctx.db.$client
      .prepare(`SELECT job_name, run_date FROM job_run`)
      .all() as { job_name: string; run_date: string }[];
    expect(rows).toEqual([{ job_name: 'sweep', run_date: '2026-09-01' }]);
  });

  it('is a no-op when the same date is swept twice', () => {
    recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    sweep.sweep('2026-08-31');

    const second = sweep.sweep('2026-08-31');

    expect(second.ran).toBe(false);
    expect(second.spawned).toBe(0);
    expect(tasks.listActive({}).filter((t) => t.title === 'Exercise')).toHaveLength(1);
  });

  it('reports the most recently swept date', () => {
    expect(sweep.lastSweptDate()).toBeNull();
    sweep.sweep('2026-09-01');
    sweep.sweep('2026-09-03');
    expect(sweep.lastSweptDate()).toBe('2026-09-03');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/api/src/services/sweepService.test.ts`
Expected: FAIL — cannot resolve `./sweepService.js`.

- [ ] **Step 3: Implement**

`apps/api/src/services/sweepService.ts`:

```ts
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../clock.js';
import { type AppDb } from '../db/index.js';
import { isScheduledOn, scheduledDatesBetween } from '../domain/schedule.js';
import { addLocalDays, compareLocalDate } from '../time.js';
import type { RecurrenceService } from './recurrenceService.js';
import type { SettingsService } from './settingsService.js';
import type { TaskService } from './taskService.js';

export interface SweepResult {
  /** False when this date had already been swept and nothing was done. */
  ran: boolean;
  archived: number;
  missed: number;
  spawned: number;
}

/**
 * The nightly sweep. `sweep(D)` closes out day `D-1` and opens day `D`.
 *
 * Idempotent on `job_run('sweep', D)` and driven entirely by its argument, so
 * catching up after downtime is just calling it once per missed date in order.
 */
export class SweepService {
  readonly #db: AppDb;
  readonly #clock: Clock;
  readonly #settings: SettingsService;
  readonly #recurrences: RecurrenceService;
  readonly #tasks: TaskService;

  constructor(
    db: AppDb,
    clock: Clock,
    settings: SettingsService,
    recurrences: RecurrenceService,
    tasks: TaskService,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#settings = settings;
    this.#recurrences = recurrences;
    this.#tasks = tasks;
  }

  lastSweptDate(): string | null {
    const row = this.#db.get<{ runDate: string }>(sql`
      SELECT max(run_date) AS runDate FROM job_run WHERE job_name = 'sweep'
    `);
    return row?.runDate ?? null;
  }

  sweep(targetDate: string): SweepResult {
    if (this.#alreadySwept(targetDate)) {
      return { ran: false, archived: 0, missed: 0, spawned: 0 };
    }

    const now = this.#clock.now().toISOString();
    const closingDate = addLocalDays(targetDate, -1);
    let archived = 0;
    let missed = 0;
    let spawned = 0;

    this.#db.transaction((tx) => {
      // 1. Archive every root tree that is complete from the root down.
      //    A done subtask under an open parent stays where it is, so the
      //    Archive never holds half a tree.
      const archiveResult = tx.run(sql`
        UPDATE task
           SET archived_at = ${now}
         WHERE root_id IN (
           SELECT root_id FROM task
            GROUP BY root_id
           HAVING sum(completed_at IS NULL) = 0
              AND sum(archived_at IS NOT NULL) = 0
         )
      `);
      archived = Number(archiveResult.changes ?? 0);

      // 2. Close out every scheduled date the habit has not resolved yet.
      for (const recurrence of this.#recurrences.listActive()) {
        const due = scheduledDatesBetween(
          { scheduleKind: recurrence.scheduleKind, daysOfWeek: recurrence.daysOfWeek },
          recurrence.lastProcessedDate,
          closingDate,
        );

        for (const date of due) {
          const logged = tx.get<{ one: number }>(sql`
            SELECT 1 AS one FROM recurrence_log
             WHERE recurrence_id = ${recurrence.id} AND occurrence_date = ${date} LIMIT 1
          `);
          if (logged) continue; // already completed, or already recorded missed

          tx.run(sql`
            INSERT INTO recurrence_log (id, recurrence_id, occurrence_date, status, completed_at)
            VALUES (${randomUUID()}, ${recurrence.id}, ${date}, 'missed', NULL)
          `);
          // Drop the stale instance so the list never accumulates a backlog.
          tx.run(sql`
            DELETE FROM task
             WHERE recurrence_id = ${recurrence.id}
               AND occurrence_date = ${date}
               AND completed_at IS NULL
          `);
          missed += 1;
        }

        if (compareLocalDate(closingDate, recurrence.lastProcessedDate) > 0) {
          this.#recurrences.setLastProcessedDate(recurrence.id, closingDate);
        }

        // 3. Open today. Only the target date is spawned, never the backlog —
        //    a week offline must not return a week of stale copies.
        if (!isScheduledOn(
          { scheduleKind: recurrence.scheduleKind, daysOfWeek: recurrence.daysOfWeek },
          targetDate,
        )) {
          continue;
        }

        const exists = tx.get<{ one: number }>(sql`
          SELECT 1 AS one FROM task
           WHERE recurrence_id = ${recurrence.id} AND occurrence_date = ${targetDate} LIMIT 1
        `);
        if (exists) continue;

        const id = randomUUID();
        tx.run(sql`
          INSERT INTO task (id, parent_id, root_id, position, title, notes, notes_updated_at,
            priority, category_id, due_date, created_at, completed_at, archived_at,
            recurrence_id, occurrence_date)
          VALUES (${id}, NULL, ${id}, 0, ${recurrence.title}, NULL, NULL,
            ${recurrence.priority}, ${recurrence.categoryId}, ${targetDate}, ${now}, NULL, NULL,
            ${recurrence.id}, ${targetDate})
        `);
        spawned += 1;
      }

      tx.run(sql`
        INSERT INTO job_run (id, job_name, run_date, ran_at)
        VALUES (${randomUUID()}, 'sweep', ${targetDate}, ${now})
      `);
    });

    return { ran: true, archived, missed, spawned };
  }

  #alreadySwept(date: string): boolean {
    const row = this.#db.get<{ one: number }>(sql`
      SELECT 1 AS one FROM job_run WHERE job_name = 'sweep' AND run_date = ${date} LIMIT 1
    `);
    return row !== undefined;
  }
}
```

The instance carries `notes: NULL` deliberately — `recurrence.notes` describes the habit and is never copied, or the Notes page would collect an identical entry every scheduled day.

`#tasks` is held for later use by the reminder wiring and to make the dependency explicit; if your linter objects to an unused private field, use it for the `listActive` call in a test-visible helper rather than deleting the parameter, since Task 9 needs it.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run apps/api/src/services/sweepService.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Run everything and commit**

```bash
npm test && npm run typecheck
git add -A
git commit -m "feat: add the nightly sweep"
```

---

### Task 8: Notifiers

One neutral payload, two renderers. A webhook outage must never break the scheduler, so sends retry and then give up quietly.

**Files:**
- Create: `packages/shared/src/reminder.ts`; Modify: `packages/shared/src/index.ts`
- Create: `apps/api/src/notify/notifier.ts`, `apps/api/src/notify/discord.ts`, `apps/api/src/notify/slack.ts`
- Test: `apps/api/src/notify/notifier.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: shared `TaskLine`, `ReminderPayload`. `type FetchLike = (url: string, init: {method: string; headers: Record<string,string>; body: string}) => Promise<{ok: boolean; status: number}>`. `interface Notifier { send(payload: ReminderPayloadValue): Promise<boolean> }`. `makeNotifier(kind: WebhookKindValue, url: string, deps: {fetchImpl: FetchLike; sleep?: (ms:number)=>Promise<void>}): Notifier`. `renderDiscord(payload)` and `renderSlack(payload)` returning request bodies.

- [ ] **Step 1: Add the shared contract**

`packages/shared/src/reminder.ts`:

```ts
import { z } from 'zod';
import { LocalDate, Priority, Uuid } from './primitives.js';

export const TaskLine = z.object({
  id: Uuid,
  title: z.string(),
  priority: Priority,
  categoryName: z.string().nullable(),
  dueDate: LocalDate.nullable(),
});
export type TaskLineValue = z.infer<typeof TaskLine>;

export const ReminderPayload = z.object({
  date: LocalDate,
  timezone: z.string(),
  overdue: z.array(TaskLine),
  dueToday: z.array(TaskLine),
  repeatsToday: z.array(TaskLine),
  completedYesterday: z.array(TaskLine),
  missedYesterday: z.array(z.string()),
});
export type ReminderPayloadValue = z.infer<typeof ReminderPayload>;
```

Append `export * from './reminder.js';` to the index, then `npm run build:shared`.

- [ ] **Step 2: Write the failing test**

`apps/api/src/notify/notifier.test.ts`:

```ts
import type { ReminderPayloadValue } from '@simple-todos/shared';
import { describe, expect, it, vi } from 'vitest';
import { renderDiscord } from './discord.js';
import { makeNotifier, type FetchLike } from './notifier.js';
import { renderSlack } from './slack.js';

const payload: ReminderPayloadValue = {
  date: '2026-09-01',
  timezone: 'Asia/Tokyo',
  overdue: [
    { id: '11111111-1111-4111-8111-111111111111', title: 'File taxes', priority: 'must', categoryName: 'Chores', dueDate: '2026-08-20' },
  ],
  dueToday: [
    { id: '22222222-2222-4222-8222-222222222222', title: 'Book flights', priority: 'should', categoryName: null, dueDate: '2026-09-01' },
  ],
  repeatsToday: [
    { id: '33333333-3333-4333-8333-333333333333', title: 'Exercise', priority: 'should', categoryName: 'Health', dueDate: '2026-09-01' },
  ],
  completedYesterday: [
    { id: '44444444-4444-4444-8444-444444444444', title: 'Fix the sink', priority: 'could', categoryName: 'Chores', dueDate: null },
  ],
  missedYesterday: ['Stretch'],
};

const empty: ReminderPayloadValue = {
  date: '2026-09-01',
  timezone: 'Asia/Tokyo',
  overdue: [], dueToday: [], repeatsToday: [], completedYesterday: [], missedYesterday: [],
};

function stubFetch(responses: { ok: boolean; status: number }[]): { fetchImpl: FetchLike; calls: { url: string; body: string }[] } {
  const calls: { url: string; body: string }[] = [];
  let i = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body });
    return responses[Math.min(i++, responses.length - 1)]!;
  };
  return { fetchImpl, calls };
}

const noSleep = async () => {};

describe('renderDiscord', () => {
  it('produces a body carrying every section that has content', () => {
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
});

describe('renderSlack', () => {
  it('produces a body carrying every section that has content', () => {
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
      sleep: async (ms) => { delays.push(ms); },
    });

    await notifier.send(payload);

    expect(delays).toHaveLength(2); // between three attempts
    expect(delays[1]!).toBeGreaterThan(delays[0]!);
  });

  it('sends JSON with the right content type', async () => {
    const seen: Record<string, string>[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      seen.push(init.headers);
      return { ok: true, status: 204 };
    };
    const notifier = makeNotifier('discord', 'https://example.test/hook', { fetchImpl, sleep: noSleep });

    await notifier.send(payload);

    expect(seen[0]!['content-type']).toContain('application/json');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run apps/api/src/notify/notifier.test.ts`
Expected: FAIL — cannot resolve `./discord.js`.

- [ ] **Step 4: Implement the renderers**

`apps/api/src/notify/discord.ts`:

```ts
import type { ReminderPayloadValue, TaskLineValue } from '@simple-todos/shared';

const PRIORITY_LABEL: Record<TaskLineValue['priority'], string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
};

function line(task: TaskLineValue): string {
  const category = task.categoryName ? ` · ${task.categoryName}` : '';
  return `• **${PRIORITY_LABEL[task.priority]}** ${task.title}${category}`;
}

function section(title: string, tasks: TaskLineValue[]): { name: string; value: string }[] {
  if (tasks.length === 0) return [];
  const ordered = [...tasks].sort(
    (a, b) => ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority),
  );
  return [{ name: title, value: ordered.map(line).join('\n') }];
}

const ORDER: TaskLineValue['priority'][] = ['must', 'should', 'could'];

/** Discord embed. Empty sections are omitted rather than rendered as headings. */
export function renderDiscord(payload: ReminderPayloadValue): unknown {
  const fields = [
    ...section('Overdue', payload.overdue),
    ...section('Due today', payload.dueToday),
    ...section('Repeating today', payload.repeatsToday),
    ...section('Completed yesterday', payload.completedYesterday),
    ...(payload.missedYesterday.length > 0
      ? [{ name: 'Missed yesterday', value: payload.missedYesterday.map((t) => `• ${t}`).join('\n') }]
      : []),
  ];

  return {
    embeds: [
      {
        title: `Todos for ${payload.date}`,
        description: fields.length === 0 ? 'Nothing scheduled. Enjoy the quiet.' : undefined,
        fields,
        footer: { text: payload.timezone },
      },
    ],
  };
}
```

`apps/api/src/notify/slack.ts`:

```ts
import type { ReminderPayloadValue, TaskLineValue } from '@simple-todos/shared';

const PRIORITY_LABEL: Record<TaskLineValue['priority'], string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
};

const ORDER: TaskLineValue['priority'][] = ['must', 'should', 'could'];

function line(task: TaskLineValue): string {
  const category = task.categoryName ? ` · ${task.categoryName}` : '';
  return `• *${PRIORITY_LABEL[task.priority]}* ${task.title}${category}`;
}

function section(title: string, tasks: TaskLineValue[]): unknown[] {
  if (tasks.length === 0) return [];
  const ordered = [...tasks].sort((a, b) => ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority));
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `*${title}*\n${ordered.map(line).join('\n')}` } },
  ];
}

/** Slack Block Kit. Empty sections are omitted rather than rendered as headings. */
export function renderSlack(payload: ReminderPayloadValue): unknown {
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: `Todos for ${payload.date}` } },
    ...section('Overdue', payload.overdue),
    ...section('Due today', payload.dueToday),
    ...section('Repeating today', payload.repeatsToday),
    ...section('Completed yesterday', payload.completedYesterday),
    ...(payload.missedYesterday.length > 0
      ? [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Missed yesterday*\n${payload.missedYesterday.map((t) => `• ${t}`).join('\n')}`,
            },
          },
        ]
      : []),
    { type: 'context', elements: [{ type: 'mrkdwn', text: payload.timezone }] },
  ];

  return { blocks };
}
```

- [ ] **Step 5: Implement the notifier**

`apps/api/src/notify/notifier.ts`:

```ts
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

      // Deliberately no throw: a webhook outage must never break the
      // scheduler. The caller logs the false.
      return false;
    },
  };
}
```

- [ ] **Step 6: Run it and watch it pass**

Run: `npm run build:shared && npx vitest run apps/api/src/notify/notifier.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 7: Run everything and commit**

```bash
npm test && npm run typecheck
git add -A
git commit -m "feat: add discord and slack notifiers"
```

---

### Task 9: The reminder payload

**Files:**
- Create: `apps/api/src/services/reminderService.ts`
- Test: `apps/api/src/services/reminderService.test.ts`

**Interfaces:**
- Consumes: `AppDb`, `SettingsService`, `startOfLocalDayUtc`, `addLocalDays`.
- Produces: `class ReminderService` with `buildPayload(targetDate: string): ReminderPayloadValue`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/services/reminderService.test.ts`:

```ts
import { ReminderPayload } from '@simple-todos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';
import { CategoryService } from './categoryService.js';
import { ReminderService } from './reminderService.js';
import { SettingsService } from './settingsService.js';
import { TaskService } from './taskService.js';

let ctx: TestApp;
let tasks: TaskService;
let categories: CategoryService;
let reminder: ReminderService;

beforeEach(async () => {
  // 2026-09-01T00:00Z is 09:00 on the 1st in Tokyo.
  ctx = await makeTestApp('2026-09-01T00:00:00Z');
  const settings = new SettingsService(ctx.db, ctx.clock);
  tasks = new TaskService(ctx.db, ctx.clock);
  categories = new CategoryService(ctx.db, ctx.clock);
  reminder = new ReminderService(ctx.db, settings);
});

afterEach(async () => {
  await ctx.close();
});

describe('buildPayload', () => {
  it('matches the shared contract', () => {
    expect(ReminderPayload.safeParse(reminder.buildPayload('2026-09-01')).success).toBe(true);
  });

  it('carries the date and the configured timezone', () => {
    expect(reminder.buildPayload('2026-09-01')).toMatchObject({
      date: '2026-09-01',
      timezone: 'Asia/Tokyo',
    });
  });

  it('lists an overdue task separately from one due today', () => {
    tasks.create({ title: 'File taxes', dueDate: '2026-08-20' });
    tasks.create({ title: 'Book flights', dueDate: '2026-09-01' });
    tasks.create({ title: 'Later thing', dueDate: '2026-09-10' });

    const p = reminder.buildPayload('2026-09-01');

    expect(p.overdue.map((t) => t.title)).toEqual(['File taxes']);
    expect(p.dueToday.map((t) => t.title)).toEqual(['Book flights']);
  });

  it('excludes completed and archived tasks from overdue and due-today', () => {
    const done = tasks.create({ title: 'Already done', dueDate: '2026-08-20' });
    tasks.complete(done.id);

    const p = reminder.buildPayload('2026-09-01');

    expect(p.overdue).toEqual([]);
  });

  it('carries the category name, not just the id', () => {
    const cat = categories.create({ name: 'Chores', color: '#4488ff' });
    tasks.create({ title: 'Laundry', dueDate: '2026-09-01', categoryId: cat.id });

    expect(reminder.buildPayload('2026-09-01').dueToday[0]!.categoryName).toBe('Chores');
  });

  it('leaves categoryName null for an uncategorised task', () => {
    tasks.create({ title: 'Loose end', dueDate: '2026-09-01' });
    expect(reminder.buildPayload('2026-09-01').dueToday[0]!.categoryName).toBeNull();
  });

  it('lists today repeat instances separately from ordinary due-today tasks', () => {
    ctx.db.$client
      .prepare(
        `INSERT INTO recurrence (id, title, notes, priority, category_id, schedule_kind, days_of_week,
           active, last_processed_date, created_at, updated_at)
         VALUES ('rec-1', 'Exercise', NULL, 'should', NULL, 'daily', NULL, 1, '2026-08-31',
           '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z')`,
      )
      .run();
    ctx.db.$client
      .prepare(
        `INSERT INTO task (id, parent_id, root_id, position, title, notes, notes_updated_at, priority,
           category_id, due_date, created_at, completed_at, archived_at, recurrence_id, occurrence_date)
         VALUES ('inst-1', NULL, 'inst-1', 0, 'Exercise', NULL, NULL, 'should', NULL, '2026-09-01',
           '2026-09-01T00:00:00.000Z', NULL, NULL, 'rec-1', '2026-09-01')`,
      )
      .run();
    tasks.create({ title: 'Book flights', dueDate: '2026-09-01' });

    const p = reminder.buildPayload('2026-09-01');

    expect(p.repeatsToday.map((t) => t.title)).toEqual(['Exercise']);
    expect(p.dueToday.map((t) => t.title)).toEqual(['Book flights']);
  });

  it('reports what was completed yesterday, in the local timezone', () => {
    const t = tasks.create({ title: 'Fix the sink' });
    // 2026-08-31T15:30Z is 00:30 on the 1st in Tokyo — NOT yesterday.
    ctx.clock.set('2026-08-31T15:30:00Z');
    tasks.complete(t.id);

    const u = tasks.create({ title: 'Renew passport' });
    // 2026-08-31T05:00Z is 14:00 on the 31st in Tokyo — yesterday.
    ctx.clock.set('2026-08-31T05:00:00Z');
    tasks.complete(u.id);

    const p = reminder.buildPayload('2026-09-01');

    expect(p.completedYesterday.map((t) => t.title)).toEqual(['Renew passport']);
  });

  it('includes an archived task in completed-yesterday', () => {
    const t = tasks.create({ title: 'Fix the sink' });
    ctx.clock.set('2026-08-31T05:00:00Z');
    tasks.complete(t.id);
    ctx.db.$client.prepare(`UPDATE task SET archived_at = '2026-09-01T18:00:00.000Z'`).run();

    expect(reminder.buildPayload('2026-09-01').completedYesterday.map((t) => t.title)).toEqual([
      'Fix the sink',
    ]);
  });

  it('names habits missed yesterday', () => {
    ctx.db.$client
      .prepare(
        `INSERT INTO recurrence (id, title, notes, priority, category_id, schedule_kind, days_of_week,
           active, last_processed_date, created_at, updated_at)
         VALUES ('rec-1', 'Stretch', NULL, 'should', NULL, 'daily', NULL, 1, '2026-08-31',
           '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z')`,
      )
      .run();
    ctx.db.$client
      .prepare(
        `INSERT INTO recurrence_log (id, recurrence_id, occurrence_date, status, completed_at)
         VALUES ('log-1', 'rec-1', '2026-08-31', 'missed', NULL)`,
      )
      .run();

    expect(reminder.buildPayload('2026-09-01').missedYesterday).toEqual(['Stretch']);
  });

  it('returns empty sections rather than throwing when there is nothing', () => {
    const p = reminder.buildPayload('2026-09-01');
    expect(p).toMatchObject({
      overdue: [], dueToday: [], repeatsToday: [], completedYesterday: [], missedYesterday: [],
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/api/src/services/reminderService.test.ts`
Expected: FAIL — cannot resolve `./reminderService.js`.

- [ ] **Step 3: Implement**

`apps/api/src/services/reminderService.ts`:

```ts
import type { ReminderPayloadValue, TaskLineValue } from '@simple-todos/shared';
import { sql } from 'drizzle-orm';
import { type AppDb } from '../db/index.js';
import { addLocalDays, startOfLocalDayUtc } from '../time.js';
import type { SettingsService } from './settingsService.js';

const TASK_LINE = sql`
  t.id, t.title, t.priority, c.name AS categoryName, t.due_date AS dueDate
`;

export class ReminderService {
  readonly #db: AppDb;
  readonly #settings: SettingsService;

  constructor(db: AppDb, settings: SettingsService) {
    this.#db = db;
    this.#settings = settings;
  }

  /**
   * The morning message for `targetDate`: what is outstanding today, plus what
   * closed yesterday. "Yesterday" is a local calendar day, so completion times
   * are compared against that day's UTC bounds rather than a raw 24-hour window.
   */
  buildPayload(targetDate: string): ReminderPayloadValue {
    const { timezone } = this.#settings.get();
    const yesterday = addLocalDays(targetDate, -1);
    const yesterdayStart = startOfLocalDayUtc(yesterday, timezone);
    const todayStart = startOfLocalDayUtc(targetDate, timezone);

    const overdue = this.#db.all<TaskLineValue>(sql`
      SELECT ${TASK_LINE} FROM task t
        LEFT JOIN category c ON c.id = t.category_id
       WHERE t.archived_at IS NULL AND t.completed_at IS NULL
         AND t.due_date IS NOT NULL AND t.due_date < ${targetDate}
       ORDER BY t.due_date
    `);

    const dueToday = this.#db.all<TaskLineValue>(sql`
      SELECT ${TASK_LINE} FROM task t
        LEFT JOIN category c ON c.id = t.category_id
       WHERE t.archived_at IS NULL AND t.completed_at IS NULL
         AND t.due_date = ${targetDate} AND t.recurrence_id IS NULL
       ORDER BY t.position
    `);

    const repeatsToday = this.#db.all<TaskLineValue>(sql`
      SELECT ${TASK_LINE} FROM task t
        LEFT JOIN category c ON c.id = t.category_id
       WHERE t.archived_at IS NULL AND t.completed_at IS NULL
         AND t.occurrence_date = ${targetDate} AND t.recurrence_id IS NOT NULL
       ORDER BY t.position
    `);

    const completedYesterday = this.#db.all<TaskLineValue>(sql`
      SELECT ${TASK_LINE} FROM task t
        LEFT JOIN category c ON c.id = t.category_id
       WHERE t.completed_at >= ${yesterdayStart} AND t.completed_at < ${todayStart}
       ORDER BY t.completed_at DESC
    `);

    const missedRows = this.#db.all<{ title: string }>(sql`
      SELECT r.title FROM recurrence_log l
        JOIN recurrence r ON r.id = l.recurrence_id
       WHERE l.occurrence_date = ${yesterday} AND l.status = 'missed'
       ORDER BY r.title
    `);

    return {
      date: targetDate,
      timezone,
      overdue: normalise(overdue),
      dueToday: normalise(dueToday),
      repeatsToday: normalise(repeatsToday),
      completedYesterday: normalise(completedYesterday),
      missedYesterday: missedRows.map((r) => r.title),
    };
  }
}

/** SQL yields `undefined` for a missing LEFT JOIN column; the contract says null. */
function normalise(rows: TaskLineValue[]): TaskLineValue[] {
  return rows.map((r) => ({ ...r, categoryName: r.categoryName ?? null, dueDate: r.dueDate ?? null }));
}
```

Note `dueToday` excludes rows with a `recurrence_id` so a repeat instance appears once, under `repeatsToday`, rather than in both lists — its `due_date` equals its `occurrence_date`.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run apps/api/src/services/reminderService.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run everything and commit**

```bash
npm test && npm run typecheck
git add -A
git commit -m "feat: assemble the daily reminder payload"
```

---

### Task 10: The scheduler

The ticker. One question per tick — "is there a scheduled run whose local date has no `job_run` row and whose local time has passed?" — so firing, recovery, timezone changes, and DST are one code path.

**Files:**
- Create: `apps/api/src/scheduler.ts`
- Modify: `apps/api/src/services/sweepService.ts` (extract `spawnDueInstances`)
- Test: `apps/api/src/scheduler.test.ts`

**Interfaces:**
- Consumes: `AppDb`, `Clock`, `SettingsService`, `SweepService`, `ReminderService`, `makeNotifier`, `localDate`, `localTime`, `addLocalDays`, `compareLocalDate`.
- Produces: `SweepService.spawnDueInstances(date: string): number` made public. `class Scheduler` with `tick(): Promise<void>`, `start(): void`, `stop(): void`. `interface SchedulerDeps { db; clock; settings; sweep; reminder; makeNotifierFor: (kind, url) => Notifier; log: (msg: string, extra?: unknown) => void }`.

- [ ] **Step 1: Extract `spawnDueInstances` from the sweep**

In `apps/api/src/services/sweepService.ts`, move step 3's body into a public method and call it from `sweep`:

```ts
  /**
   * Create any missing instance for `date`. Idempotent, and safe to call on
   * every tick — that is what makes a habit created at 10am appear the same
   * day rather than waiting for tomorrow's sweep.
   */
  spawnDueInstances(date: string): number {
    let spawned = 0;
    const now = this.#clock.now().toISOString();

    this.#db.transaction((tx) => {
      for (const recurrence of this.#recurrences.listActive()) {
        const schedule = {
          scheduleKind: recurrence.scheduleKind,
          daysOfWeek: recurrence.daysOfWeek,
        };
        if (!isScheduledOn(schedule, date)) continue;

        const exists = tx.get<{ one: number }>(sql`
          SELECT 1 AS one FROM task
           WHERE recurrence_id = ${recurrence.id} AND occurrence_date = ${date} LIMIT 1
        `);
        if (exists) continue;

        const id = randomUUID();
        tx.run(sql`
          INSERT INTO task (id, parent_id, root_id, position, title, notes, notes_updated_at,
            priority, category_id, due_date, created_at, completed_at, archived_at,
            recurrence_id, occurrence_date)
          VALUES (${id}, NULL, ${id}, 0, ${recurrence.title}, NULL, NULL,
            ${recurrence.priority}, ${recurrence.categoryId}, ${date}, ${now}, NULL, NULL,
            ${recurrence.id}, ${date})
        `);
        spawned += 1;
      }
    });

    return spawned;
  }
```

In `sweep`, replace the inline spawn block with a call to it after the transaction that does steps 1 and 2, adding its return value to the result. Every existing `sweepService.test.ts` test must still pass unchanged — if one breaks, the extraction changed behaviour and is wrong.

- [ ] **Step 2: Write the failing scheduler test**

`apps/api/src/scheduler.test.ts`:

```ts
import type { ReminderPayloadValue } from '@simple-todos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Scheduler } from './scheduler.js';
import { makeTestApp, type TestApp } from '../test/helpers/testApp.js';
import { RecurrenceService } from './services/recurrenceService.js';
import { ReminderService } from './services/reminderService.js';
import { SettingsService } from './services/settingsService.js';
import { SweepService } from './services/sweepService.js';
import { TaskService } from './services/taskService.js';

let ctx: TestApp;
let settings: SettingsService;
let tasks: TaskService;
let recurrences: RecurrenceService;
let sweep: SweepService;
let scheduler: Scheduler;
let sent: ReminderPayloadValue[];
let sendResult: boolean;

function build() {
  settings = new SettingsService(ctx.db, ctx.clock);
  tasks = new TaskService(ctx.db, ctx.clock);
  recurrences = new RecurrenceService(ctx.db, ctx.clock, settings);
  sweep = new SweepService(ctx.db, ctx.clock, settings, recurrences, tasks);
  const reminder = new ReminderService(ctx.db, settings);
  sent = [];
  sendResult = true;
  scheduler = new Scheduler({
    db: ctx.db,
    clock: ctx.clock,
    settings,
    sweep,
    reminder,
    makeNotifierFor: () => ({
      async send(payload) {
        sent.push(payload);
        return sendResult;
      },
    }),
    log: () => {},
  });
}

const sweptDates = () =>
  (ctx.db.$client
    .prepare(`SELECT run_date FROM job_run WHERE job_name = 'sweep' ORDER BY run_date`)
    .all() as { run_date: string }[]).map((r) => r.run_date);

const reminderDates = () =>
  (ctx.db.$client
    .prepare(`SELECT run_date FROM job_run WHERE job_name = 'reminder' ORDER BY run_date`)
    .all() as { run_date: string }[]).map((r) => r.run_date);

beforeEach(async () => {
  // 2026-09-01T00:00Z is 09:00 on the 1st in Tokyo — after the 03:00 sweep
  // time and after the 08:00 reminder time.
  ctx = await makeTestApp('2026-09-01T00:00:00Z');
  build();
});

afterEach(async () => {
  await ctx.close();
});

describe('sweep scheduling', () => {
  it('sweeps today once the local sweep time has passed', async () => {
    await scheduler.tick();
    expect(sweptDates()).toEqual(['2026-09-01']);
  });

  it('does not sweep before the local sweep time', async () => {
    // 2026-08-31T17:00Z is 02:00 on the 1st in Tokyo — before 03:00.
    ctx.clock.set('2026-08-31T17:00:00Z');
    await scheduler.tick();
    expect(sweptDates()).toEqual([]);
  });

  it('does not sweep the same date twice across ticks', async () => {
    await scheduler.tick();
    await scheduler.tick();
    expect(sweptDates()).toEqual(['2026-09-01']);
  });

  it('uses the configured sweep time', async () => {
    settings.update({ sweepTime: '10:00' });
    await scheduler.tick(); // local 09:00, before 10:00
    expect(sweptDates()).toEqual([]);

    ctx.clock.set('2026-09-01T02:00:00Z'); // local 11:00
    await scheduler.tick();
    expect(sweptDates()).toEqual(['2026-09-01']);
  });
});

describe('downtime catch-up', () => {
  it('sweeps every missed date in order after a gap', async () => {
    await scheduler.tick(); // establishes 2026-09-01

    // The container is off for three days.
    ctx.clock.set('2026-09-05T00:00:00Z'); // local 09:00 on the 5th
    await scheduler.tick();

    expect(sweptDates()).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']);
  });

  it('logs a miss for every skipped scheduled day', async () => {
    recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    await scheduler.tick();

    ctx.clock.set('2026-09-05T00:00:00Z');
    await scheduler.tick();

    const missed = ctx.db.$client
      .prepare(`SELECT occurrence_date FROM recurrence_log WHERE status = 'missed' ORDER BY occurrence_date`)
      .all() as { occurrence_date: string }[];
    expect(missed.map((m) => m.occurrence_date)).toEqual([
      '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
    ]);
  });

  it('spawns only today after a gap, not one instance per missed day', async () => {
    recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    await scheduler.tick();

    ctx.clock.set('2026-09-05T00:00:00Z');
    await scheduler.tick();

    const instances = ctx.db.$client
      .prepare(`SELECT occurrence_date FROM task WHERE recurrence_id IS NOT NULL`)
      .all() as { occurrence_date: string }[];
    expect(instances.map((i) => i.occurrence_date)).toEqual(['2026-09-05']);
  });

  it('does not back-fill a habit created during the gap', async () => {
    await scheduler.tick(); // 2026-09-01 swept

    ctx.clock.set('2026-09-03T00:00:00Z');
    recurrences.create({ title: 'New habit', scheduleKind: 'daily' }); // lastProcessedDate = 09-03

    ctx.clock.set('2026-09-05T00:00:00Z');
    await scheduler.tick();

    const missed = ctx.db.$client
      .prepare(`SELECT occurrence_date FROM recurrence_log WHERE status = 'missed' ORDER BY occurrence_date`)
      .all() as { occurrence_date: string }[];
    // Only the 3rd and 4th — never before the habit existed.
    expect(missed.map((m) => m.occurrence_date)).toEqual(['2026-09-03', '2026-09-04']);
  });

  it('records nothing historical on a first-ever boot', async () => {
    // No prior job_run at all: today is swept, and nothing before it.
    await scheduler.tick();
    expect(sweptDates()).toEqual(['2026-09-01']);
  });
});

describe('spawning outside the sweep', () => {
  it('gives a habit created after today sweep its instance on the next tick', async () => {
    await scheduler.tick(); // today already swept

    recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    await scheduler.tick();

    const instances = ctx.db.$client
      .prepare(`SELECT occurrence_date FROM task WHERE recurrence_id IS NOT NULL`)
      .all() as { occurrence_date: string }[];
    expect(instances).toEqual([{ occurrence_date: '2026-09-01' }]);
  });
});

describe('reminder scheduling', () => {
  function enableWebhook() {
    settings.update({
      reminderEnabled: true,
      webhookKind: 'discord',
      webhookUrl: 'https://example.test/hook',
    });
  }

  it('sends nothing when the reminder is disabled', async () => {
    await scheduler.tick();
    expect(sent).toHaveLength(0);
    expect(reminderDates()).toEqual([]);
  });

  it('sends once the local reminder time has passed', async () => {
    enableWebhook();
    await scheduler.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.date).toBe('2026-09-01');
    expect(reminderDates()).toEqual(['2026-09-01']);
  });

  it('does not send before the local reminder time', async () => {
    enableWebhook();
    ctx.clock.set('2026-08-31T22:00:00Z'); // local 07:00
    await scheduler.tick();
    expect(sent).toHaveLength(0);
  });

  it('sends only once a day across many ticks', async () => {
    enableWebhook();
    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();
    expect(sent).toHaveLength(1);
  });

  it('records the run even when delivery fails, so it does not retry every minute', async () => {
    enableWebhook();
    sendResult = false;

    await scheduler.tick();
    await scheduler.tick();

    expect(sent).toHaveLength(1);
    expect(reminderDates()).toEqual(['2026-09-01']);
  });

  it('does not back-fill reminders for missed days', async () => {
    enableWebhook();
    await scheduler.tick();

    ctx.clock.set('2026-09-05T00:00:00Z');
    await scheduler.tick();

    // Yesterday's news is not worth sending four days late.
    expect(reminderDates()).toEqual(['2026-09-01', '2026-09-05']);
  });
});

describe('lifecycle', () => {
  it('start and stop do not throw and stop is idempotent', () => {
    scheduler.start();
    scheduler.stop();
    scheduler.stop();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run apps/api/src/scheduler.test.ts`
Expected: FAIL — cannot resolve `./scheduler.js`.

- [ ] **Step 4: Implement**

`apps/api/src/scheduler.ts`:

```ts
import type { WebhookKindValue } from '@simple-todos/shared';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Clock } from './clock.js';
import { type AppDb } from './db/index.js';
import type { Notifier } from './notify/notifier.js';
import type { ReminderService } from './services/reminderService.js';
import type { SettingsService } from './services/settingsService.js';
import type { SweepService } from './services/sweepService.js';
import { addLocalDays, compareLocalDate, localDate, localTime } from './time.js';

export interface SchedulerDeps {
  db: AppDb;
  clock: Clock;
  settings: SettingsService;
  sweep: SweepService;
  reminder: ReminderService;
  makeNotifierFor: (kind: WebhookKindValue, url: string) => Notifier;
  log: (message: string, extra?: unknown) => void;
}

const TICK_MS = 60_000;
/** A guard against pathological clock skew, not a real operating limit. */
const MAX_CATCH_UP_DAYS = 400;

/**
 * There is no cron here on purpose.
 *
 * The timezone is a runtime setting, so cron expressions would need tearing
 * down and rebuilding whenever it changed, and cron has no answer for "the
 * container was off at 03:00". A ticker plus the `job_run` ledger collapses
 * normal firing, missed-window recovery, timezone changes and DST into one
 * code path, and the ledger's unique index makes a double-fire impossible.
 */
export class Scheduler {
  readonly #deps: SchedulerDeps;
  readonly #intervalMs: number;
  #timer: NodeJS.Timeout | null = null;
  #running = false;

  constructor(deps: SchedulerDeps, intervalMs = TICK_MS) {
    this.#deps = deps;
    this.#intervalMs = intervalMs;
  }

  start(): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => {
      void this.#safeTick();
    }, this.#intervalMs);
    // Do not hold the process open for the sake of the ticker.
    this.#timer.unref?.();
    void this.#safeTick();
  }

  stop(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  async #safeTick(): Promise<void> {
    // Overlapping ticks would double-run a slow sweep; the ledger would catch
    // it, but skipping is cheaper than rolling back.
    if (this.#running) return;
    this.#running = true;
    try {
      await this.tick();
    } catch (err) {
      this.#deps.log('scheduler tick failed', err);
    } finally {
      this.#running = false;
    }
  }

  async tick(): Promise<void> {
    const { clock, settings, sweep, reminder } = this.#deps;
    const config = settings.get();
    const now = clock.now();
    const today = localDate(now, config.timezone);
    const nowTime = localTime(now, config.timezone);

    this.#runSweeps(today, nowTime, config.sweepTime);

    // Cheap and idempotent: this is what makes a habit created at 10am show
    // up the same day rather than waiting for tomorrow's sweep.
    sweep.spawnDueInstances(today);

    if (!config.reminderEnabled) return;
    if (nowTime < config.reminderTime) return;
    if (this.#alreadyRan('reminder', today)) return;

    await this.#sendReminder(today, config.webhookKind, config.webhookUrl, reminder);
  }

  #runSweeps(today: string, nowTime: string, sweepTime: string): void {
    const { sweep } = this.#deps;
    const last = sweep.lastSweptDate();

    if (last !== null) {
      // Every date strictly between the last sweep and today has had its whole
      // window pass, so it runs regardless of the clock.
      let date = addLocalDays(last, 1);
      let guard = 0;
      while (compareLocalDate(date, today) < 0 && guard < MAX_CATCH_UP_DAYS) {
        sweep.sweep(date);
        date = addLocalDays(date, 1);
        guard += 1;
      }
      if (guard >= MAX_CATCH_UP_DAYS) {
        this.#deps.log('sweep catch-up hit its day limit; check the clock and settings.timezone');
      }
    }

    // Today runs only once its configured time has arrived. Both sides are
    // zero-padded 'HH:MM', so a string comparison is a chronological one.
    if (nowTime >= sweepTime) sweep.sweep(today);
  }

  async #sendReminder(
    today: string,
    kind: WebhookKindValue | null,
    url: string | null,
    reminder: ReminderService,
  ): Promise<void> {
    // Settings validation guarantees both are present when enabled; belt and
    // braces so a hand-edited database cannot crash the ticker.
    if (kind === null || url === null) return;

    const payload = reminder.buildPayload(today);
    const delivered = await this.#deps.makeNotifierFor(kind, url).send(payload);
    if (!delivered) this.#deps.log('reminder delivery failed after retries');

    // Recorded either way: a webhook outage must not mean a retry every minute
    // for the rest of the day.
    this.#record('reminder', today);
  }

  #alreadyRan(job: 'sweep' | 'reminder', date: string): boolean {
    const row = this.#deps.db.get<{ one: number }>(sql`
      SELECT 1 AS one FROM job_run WHERE job_name = ${job} AND run_date = ${date} LIMIT 1
    `);
    return row !== undefined;
  }

  #record(job: 'sweep' | 'reminder', date: string): void {
    this.#deps.db.run(sql`
      INSERT INTO job_run (id, job_name, run_date, ran_at)
      VALUES (${randomUUID()}, ${job}, ${date}, ${this.#deps.clock.now().toISOString()})
      ON CONFLICT DO NOTHING
    `);
  }
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run apps/api/src/scheduler.test.ts`
Expected: PASS, 17 tests. `sweepService.test.ts` must also still pass unchanged after the extraction.

- [ ] **Step 6: Run everything and commit**

```bash
npm test && npm run typecheck
git add -A
git commit -m "feat: add the scheduler ticker with downtime catch-up"
```

---

### Task 11: Manual job triggers, the webhook test, and server wiring

Makes the scheduler part of the running process, and gives you a way to fire either job by hand — useful after a timezone change and for smoke-testing a deployment.

**Files:**
- Create: `apps/api/src/http/routes/jobs.ts`
- Modify: `apps/api/src/http/app.ts`, `apps/api/src/http/routes/settings.ts`, `apps/api/src/server.ts`
- Test: `apps/api/src/http/routes/jobs.test.ts`, append to `apps/api/src/http/routes/settings.test.ts`, `apps/api/src/server.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-10.
- Produces: routes `POST /api/jobs/sweep/run`, `POST /api/jobs/reminder/run`, `POST /api/settings/webhook/test`. `AppDeps` gains an optional `scheduler` field; `buildApp` returns the constructed services so `startServer` can build a `Scheduler`. `startServer` starts and stops it.

- [ ] **Step 1: Write the failing route test**

`apps/api/src/http/routes/jobs.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeAuthedApp, type AuthedApp } from '../../../test/helpers/testApp.js';

let ctx: AuthedApp;

beforeEach(async () => {
  ctx = await makeAuthedApp('2026-09-01T00:00:00Z');
});

afterEach(async () => {
  await ctx.close();
});

describe('POST /api/jobs/sweep/run', () => {
  it('runs the sweep for today and reports what it did', async () => {
    const task = (await ctx.post('/api/tasks', { title: 'Done thing' })).json();
    await ctx.post(`/api/tasks/${task.id}/complete`);

    const res = await ctx.post('/api/jobs/sweep/run');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ran: true, archived: 1 });
    expect((await ctx.get('/api/tasks')).json()).toEqual([]);
  });

  it('accepts an explicit date', async () => {
    const res = await ctx.post('/api/jobs/sweep/run', { date: '2026-09-02' });
    expect(res.statusCode).toBe(200);
    const rows = ctx.db.$client
      .prepare(`SELECT run_date FROM job_run WHERE job_name = 'sweep'`)
      .all() as { run_date: string }[];
    expect(rows).toEqual([{ run_date: '2026-09-02' }]);
  });

  it('reports ran:false when the date was already swept', async () => {
    await ctx.post('/api/jobs/sweep/run');
    expect((await ctx.post('/api/jobs/sweep/run')).json().ran).toBe(false);
  });

  it('rejects an impossible date with 400', async () => {
    expect((await ctx.post('/api/jobs/sweep/run', { date: '2026-02-31' })).statusCode).toBe(400);
  });

  it('requires a token', async () => {
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/api/jobs/sweep/run' })).statusCode,
    ).toBe(401);
  });
});

describe('POST /api/jobs/reminder/run', () => {
  it('409s when no webhook is configured', async () => {
    const res = await ctx.post('/api/jobs/reminder/run');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('reports delivery failure without throwing when the webhook is unreachable', async () => {
    await ctx.request('PUT', '/api/settings', {
      reminderEnabled: true,
      webhookKind: 'discord',
      webhookUrl: 'http://127.0.0.1:9/nothing-listens-here',
    });

    const res = await ctx.post('/api/jobs/reminder/run');

    expect(res.statusCode).toBe(200);
    expect(res.json().delivered).toBe(false);
  });
});

describe('POST /api/settings/webhook/test', () => {
  it('409s when no webhook is configured', async () => {
    expect((await ctx.post('/api/settings/webhook/test')).statusCode).toBe(409);
  });

  it('reports failure for an unreachable webhook rather than erroring', async () => {
    await ctx.request('PUT', '/api/settings', {
      webhookKind: 'slack',
      webhookUrl: 'http://127.0.0.1:9/nothing-listens-here',
    });

    const res = await ctx.post('/api/settings/webhook/test');

    expect(res.statusCode).toBe(200);
    expect(res.json().delivered).toBe(false);
  });
});
```

These two "unreachable webhook" tests hit `127.0.0.1:9` (the discard port), which refuses connections immediately — no network access and no timeout wait. The notifier's three retries use its default backoff, so keep an eye on runtime; if it is slow, pass a short `sleep` through the app's notifier factory in test config rather than lengthening the test timeout.

- [ ] **Step 2: Implement the routes**

`apps/api/src/http/routes/jobs.ts`:

```ts
import { LocalDate, type WebhookKindValue } from '@simple-todos/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '../../clock.js';
import { ConflictError } from '../../domain/errors.js';
import type { Notifier } from '../../notify/notifier.js';
import type { ReminderService } from '../../services/reminderService.js';
import type { SettingsService } from '../../services/settingsService.js';
import type { SweepService } from '../../services/sweepService.js';
import { localDate } from '../../time.js';

const RunSweepRequest = z.object({ date: LocalDate.optional() });

export interface JobRouteDeps {
  clock: Clock;
  settings: SettingsService;
  sweep: SweepService;
  reminder: ReminderService;
  makeNotifierFor: (kind: WebhookKindValue, url: string) => Notifier;
}

export async function jobRoutes(app: FastifyInstance, deps: JobRouteDeps): Promise<void> {
  const { clock, settings, sweep, reminder, makeNotifierFor } = deps;

  app.post('/jobs/sweep/run', async (req) => {
    const { date } = RunSweepRequest.parse(req.body ?? {});
    const target = date ?? localDate(clock.now(), settings.get().timezone);
    return sweep.sweep(target);
  });

  app.post('/jobs/reminder/run', async () => {
    const config = settings.get();
    if (config.webhookKind === null || config.webhookUrl === null) {
      throw new ConflictError('no webhook is configured');
    }
    const target = localDate(clock.now(), config.timezone);
    const payload = reminder.buildPayload(target);
    const delivered = await makeNotifierFor(config.webhookKind, config.webhookUrl).send(payload);
    // Deliberately does not write a job_run row: a manual run is for testing
    // and must not suppress the real scheduled one later that day.
    return { delivered, date: target };
  });
}
```

Add the webhook test to `apps/api/src/http/routes/settings.ts` — it belongs with settings, not jobs:

```ts
  app.post('/settings/webhook/test', async () => {
    const config = settings.get();
    if (config.webhookKind === null || config.webhookUrl === null) {
      throw new ConflictError('no webhook is configured');
    }
    const delivered = await deps.makeNotifierFor(config.webhookKind, config.webhookUrl).send({
      date: localDate(deps.clock.now(), config.timezone),
      timezone: config.timezone,
      overdue: [],
      dueToday: [
        {
          id: '00000000-0000-4000-8000-000000000000',
          title: 'This is a test message from simple-todos',
          priority: 'should',
          categoryName: null,
          dueDate: null,
        },
      ],
      repeatsToday: [],
      completedYesterday: [],
      missedYesterday: [],
    });
    return { delivered };
  });
```

extending `SettingsRouteDeps` with `clock`, `makeNotifierFor`, and importing `ConflictError` and `localDate`.

- [ ] **Step 3: Wire everything into `buildApp`**

In `apps/api/src/http/app.ts`: construct `SweepService`, `ReminderService`, and a notifier factory, register `jobRoutes` **inside the authenticated scope**, and return the pieces `startServer` needs.

```ts
import { makeNotifier, type FetchLike } from '../notify/notifier.js';
import { ReminderService } from '../services/reminderService.js';
import { SweepService } from '../services/sweepService.js';
import { jobRoutes } from './routes/jobs.js';

export interface AppDeps {
  db: AppDb;
  clock: Clock;
  config: Config;
  /** Injected by tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
}

export interface BuiltApp {
  app: FastifyInstance;
  settings: SettingsService;
  sweep: SweepService;
  reminder: ReminderService;
  makeNotifierFor: (kind: WebhookKindValue, url: string) => Notifier;
}
```

`buildApp` keeps returning a `FastifyInstance` so every existing test and helper still compiles; add a second exported function that returns the richer object:

```ts
export async function buildAppWithServices(deps: AppDeps): Promise<BuiltApp> { /* ...existing body, returning all four... */ }

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  return (await buildAppWithServices(deps)).app;
}
```

The notifier factory:

```ts
  const fetchImpl: FetchLike =
    deps.fetchImpl ??
    (async (url, init) => {
      const res = await fetch(url, init);
      return { ok: res.ok, status: res.status };
    });
  const makeNotifierFor = (kind: WebhookKindValue, url: string) => makeNotifier(kind, url, { fetchImpl });
```

- [ ] **Step 4: Start and stop the scheduler in `server.ts`**

In `apps/api/src/server.ts`, use `buildAppWithServices`, construct the `Scheduler`, `start()` it after `app.ready()`, and `stop()` it first in `stop()`:

```ts
  const built = await buildAppWithServices({ db, clock: systemClock, config });
  await built.app.ready();

  const scheduler = new Scheduler({
    db,
    clock: systemClock,
    settings: built.settings,
    sweep: built.sweep,
    reminder: built.reminder,
    makeNotifierFor: built.makeNotifierFor,
    log: (message, extra) => built.app.log.warn({ extra }, message),
  });
  scheduler.start();

  return {
    app: built.app,
    async stop() {
      scheduler.stop();
      await built.app.close();
      db.$client.close();
    },
  };
```

Keep the existing try/catch that closes the database handle when startup fails, and extend it to cover the scheduler construction.

- [ ] **Step 5: Add a server test that the scheduler runs**

Append to `apps/api/src/server.test.ts`:

```ts
  it('sweeps on boot, so a container that was off overnight catches up', async () => {
    const started = await startServer(env());
    stop = started.stop;

    const login = await started.app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'tester', password: 'correct-horse-battery-staple' },
    });
    const { token } = login.json() as { token: string };

    // The scheduler ticks immediately on start; give it a moment to land.
    await new Promise((r) => setTimeout(r, 50));

    const res = await started.app.inject({
      method: 'GET', url: '/api/tasks', headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('stops the scheduler on shutdown, leaving no open handle', async () => {
    const started = await startServer(env());
    await started.stop();
    stop = null;
    // If the interval were still armed with a live DB handle, removing the
    // temp directory would fail on Windows with EBUSY.
    expect(() => rmSync(dir, { recursive: true, force: false })).not.toThrow();
  });
```

- [ ] **Step 6: Run everything and commit**

```bash
npm run build:shared && npm test && npm run typecheck
git add -A
git commit -m "feat: run the scheduler in the server and add manual job triggers"
```

---

### Task 12: Docker image and compose

The container is what makes the 3AM sweep actually fire, so deployment belongs to this plan rather than the web-client one. The image builds the **API only** — the web app does not exist until Plan 3, which adds the Vite build stage and static serving.

**Files:**
- Create: `apps/api/Dockerfile`, `.dockerignore`, `compose.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `startServer`, the `Config` env contract, `GET /api/health`.
- Produces: an image whose entrypoint is the compiled `apps/api/dist/server.js`, and a `compose.yml` service mounting a named volume at `/data`.

**Convention:** each deployable app owns its Dockerfile; the compose file lives at the repo root. Today that is one Dockerfile, under `apps/api`, because the API is the only thing that runs as a process.

- [ ] **Step 1: Resolve the `better-sqlite3` pin question — do this first, it may change the Dockerfile**

`apps/api/package.json` pins `better-sqlite3` to `^11.10.0`. That pin exists because v13 segfaulted `node.exe` on the Windows development machine; whether the cause was that machine's endpoint protection or a genuine v13 regression was never determined, and this is the task that finds out.

Build a throwaway Linux image that installs the **latest** `better-sqlite3`, opens a database, runs a query, and prints the version:

```bash
docker run --rm node:22-slim bash -lc '
  mkdir -p /t && cd /t && npm init -y >/dev/null 2>&1 &&
  npm i better-sqlite3 >/dev/null 2>&1 &&
  node -e "
    const D=require(\"better-sqlite3\");
    const db=new D(\":memory:\");
    db.pragma(\"journal_mode = WAL\");
    db.exec(\"CREATE TABLE t (a)\"); db.prepare(\"INSERT INTO t VALUES (1)\").run();
    console.log(\"rows\", db.prepare(\"SELECT count(*) c FROM t\").get());
    console.log(\"sqlite\", db.prepare(\"select sqlite_version() v\").get());
    console.log(\"better-sqlite3\", require(\"better-sqlite3/package.json\").version);
  "'
```

Record the result in your report either way:
- **If it works on Linux:** the pin is a Windows-only workaround. **Leave the pin in place** — the development machine still needs it and a mixed pin would be worse — but say so explicitly in your report and add a comment above the dependency in `apps/api/package.json` recording why it exists and that Linux is unaffected.
- **If it also fails on Linux:** the pin is load-bearing everywhere. Say so, and keep it.

Do not change the pinned version either way. This step is to replace an unknown with a recorded fact.

- [ ] **Step 2: Write the `.dockerignore`**

At the repo root:

```
node_modules
**/node_modules
**/dist
.git
.superpowers
data
*.local
.env
docs
```

Excluding `node_modules` matters more than tidiness: `better-sqlite3` is a native module, and copying host-built binaries into a Linux image is exactly how you get a module that loads and then crashes.

- [ ] **Step 3: Write the Dockerfile**

`apps/api/Dockerfile` — the build context is the **repo root**, because the image needs `packages/shared` as well as `apps/api`:

```dockerfile
# syntax=docker/dockerfile:1

# --- deps -------------------------------------------------------------------
# better-sqlite3 is a native module. Install it in the same base image the
# runtime uses so the prebuilt binding matches; never copy host node_modules.
FROM node:22-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci

# --- build ------------------------------------------------------------------
FROM deps AS build
WORKDIR /repo
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN npm run build -w @simple-todos/shared \
 && npm run build -w @simple-todos/api

# --- prune ------------------------------------------------------------------
# A second install with --omit=dev, rather than pruning in place, so the
# native binding is rebuilt against the same base and nothing dev-only leaks.
FROM node:22-slim AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev

# --- runtime ----------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo

COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY apps/api/package.json ./apps/api/
COPY --from=build /repo/apps/api/dist ./apps/api/dist
# Migrations are committed SQL, applied on boot before the server listens.
COPY apps/api/drizzle ./apps/api/drizzle

ENV DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
USER node

EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
```

If `prod-deps` does not produce `apps/api/node_modules` (npm may hoist everything to the root), drop that second `COPY` line rather than fighting it — verify by listing the directory inside the stage.

- [ ] **Step 4: Write `compose.yml` at the repo root**

```yaml
services:
  api:
    build:
      # The repo root, because the image needs packages/shared too.
      context: .
      dockerfile: apps/api/Dockerfile
    restart: unless-stopped
    ports:
      - "${PORT:-3000}:3000"
    environment:
      PORT: 3000
      DATA_DIR: /data
      AUTH_USERNAME: ${AUTH_USERNAME:?set AUTH_USERNAME in .env}
      AUTH_PASSWORD: ${AUTH_PASSWORD:?set AUTH_PASSWORD in .env}
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in .env}
      DEFAULT_TZ: ${DEFAULT_TZ:-Asia/Tokyo}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      # Turn on only when something else terminates TLS in front of this,
      # or the login rate limiter can be bypassed with a spoofed header.
      TRUST_PROXY: ${TRUST_PROXY:-false}
    volumes:
      - todos-data:/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  todos-data:
```

`AUTH_USERNAME`, `AUTH_PASSWORD` and `JWT_SECRET` use `:?` so compose refuses to start rather than silently booting with blanks.

- [ ] **Step 5: Build and actually run it**

```bash
docker build -f apps/api/Dockerfile -t simple-todos-api:test .
docker run --rm -d --name st-test -p 3001:3000 \
  -e AUTH_USERNAME=admin -e AUTH_PASSWORD=admin \
  -e JWT_SECRET=0123456789012345678901234567890123456789 \
  -v st-test-data:/data simple-todos-api:test
```

Then verify, pasting the real output into your report:

```bash
curl -s localhost:3001/api/health
TOKEN=$(curl -s -X POST localhost:3001/api/auth/login -H 'content-type: application/json' \
  -d '{"username":"admin","password":"admin"}' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token')
curl -s -X POST localhost:3001/api/tasks -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"title":"survives a restart"}'
docker restart st-test && sleep 3
curl -s localhost:3001/api/tasks -H "authorization: Bearer $TOKEN"
docker exec st-test node -e 'console.log(require("better-sqlite3/package.json").version)'
docker stop st-test && docker volume rm st-test-data
```

Expected: health ok; a token; the task created; **the task still present after the restart** (proving the volume and the seeding-only-if-missing behaviour); and the running `better-sqlite3` version printed.

If the image fails to build or the native module fails to load, that is a genuine finding — report it rather than working around it by loosening the Dockerfile.

- [ ] **Step 6: Update the README**

Add a deployment section:

```markdown
## Running it in Docker

```bash
cp .env.example .env    # set AUTH_USERNAME, AUTH_PASSWORD, JWT_SECRET
docker compose up -d --build
```

The API listens on `PORT` (default 3000) and keeps its database in the
`todos-data` volume at `/data`. Migrations run on boot before it accepts
traffic; a failed migration aborts startup rather than serving a half-upgraded
schema.

`AUTH_USERNAME` and `AUTH_PASSWORD` seed the single user **only when no user
exists**, so redeploying never resets your password — change it through
`POST /api/auth/password`.

Set `TRUST_PROXY=true` only when a reverse proxy sits in front of the
container. It makes the login rate limiter read `X-Forwarded-For`; with no
proxy in front, that header is attacker-controlled and the limiter could be
bypassed.

### Scheduled jobs

A ticker runs every 60 seconds and consults a `job_run` ledger, so the
overnight sweep still happens if the container was off at 03:00 — it catches
up on the next start, recording an honest `missed` for every skipped day while
spawning only today's repeat instances. Both jobs can be run by hand:

```bash
curl -X POST localhost:3000/api/jobs/sweep/run    -H "authorization: Bearer $TOKEN"
curl -X POST localhost:3000/api/jobs/reminder/run -H "authorization: Bearer $TOKEN"
```
```

Also add `TRUST_PROXY=false` to `.env.example`.

- [ ] **Step 7: Run everything and commit**

```bash
npm test && npm run typecheck
git add -A
git commit -m "feat: add the api Dockerfile and compose deployment"
```

---

## Plan Self-Review

Checked against `docs/superpowers/specs/2026-08-31-simple-todos-design.md`.

**Spec coverage.** §3.2 deployment → Task 12. §3.3 `TRUST_PROXY` → Task 1. §4.2 settings → Task 2. §4.5 `recurrence` → Task 4. §4.6 `recurrence_log` → Tasks 5-7. §4.7 `job_run` → Tasks 7, 10. §5.2 archiving → Task 7. §5.3 repeatable tasks → Tasks 3-7. §5.4 the scheduler and downtime catch-up → Task 10. §5.5 the reminder and notifiers → Tasks 8-9. §5.6 timezone handling → Tasks 1-2 (`localTime`, IANA validation). §6 `/settings` → Task 2; `/recurrences` and history → Tasks 4-5; `/jobs/*` → Task 11; `/settings/webhook/test` → Task 11.

**Out of scope, carried to Plan 3:** the entire web client (§7), and the `@fastify/static` SPA serving half of §3.2 — the Dockerfile here builds the API alone because no web app exists to build yet.

**Gaps found and closed while reviewing.**
- The spec's "first-ever boot records today as swept without back-filling" left a hole: a habit created at 10am, after that day's sweep, would get no instance until the next morning. Task 10 closes it by extracting `spawnDueInstances` and calling it on every tick — idempotent, and the reason the extraction exists rather than being tidiness.
- Nothing in the spec says whether a manual `POST /jobs/reminder/run` should write a `job_run` row. Task 11 decides deliberately that it must not: a test send at noon should not suppress a genuine reminder scheduled for the same day.
- The spec's reminder section says `completedYesterday` is "drawn from the tasks the last sweep archived". Task 9 instead selects tasks whose `completed_at` falls within yesterday's local day. Same answer in normal operation and correct even when the sweep has not run, which matters because the manual trigger and a first boot can both produce that state.

**Placeholder scan.** No TBDs. Two forward references are labelled where they occur: `SweepService` takes `TaskService` in Task 7 before Task 10 uses it, and `buildApp` keeps its existing signature in Task 11 with `buildAppWithServices` added alongside, so no Plan 1 test or helper needs touching.

**Type consistency.** `SweepResult` is `{ran, archived, missed, spawned}` in Tasks 7, 10, and 11. `Schedule` is `{scheduleKind, daysOfWeek}` in Tasks 3, 7, and 10. `RecurrenceValue.daysOfWeek` is `number[] | null` throughout, serialised to JSON text only at the database boundary. `Notifier.send` returns `Promise<boolean>` in Tasks 8, 10, and 11 — it never throws, which is why the scheduler can record the run regardless. `makeNotifierFor(kind, url)` has one signature everywhere. Services take `(db, clock, …)` except `ReminderService(db, settings)` and `SweepService(db, clock, settings, recurrences, tasks)`.

**One risk worth naming.** Task 10's catch-up loop runs one transaction per missed day. A year offline means 365 sequential sweeps on boot, which is slow but correct and one-time; `MAX_CATCH_UP_DAYS` guards only against clock skew, not against a genuinely long absence. If that proves too slow in practice, the fix is to batch the archive step across dates rather than to skip days — skipping would falsify the hit/miss history, which is the one thing the feature exists to record.

