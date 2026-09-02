# simple-todos Web Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web client — five screens behind a login, served by the same container as the API.

**Architecture:** React + Vite + TanStack Query in `apps/web`, importing `@simple-todos/shared` so every request and response is the same typed contract the API validates. In production Fastify serves the built SPA through `@fastify/static` alongside `/api/*`, so one container and one origin; in development Vite proxies `/api` to Fastify.

**Tech Stack:** Node 22, TypeScript (ESM, strict), React 19, Vite, TanStack Query, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-08-31-simple-todos-design.md` (§7 is this plan)

**Predecessors:** `2026-08-31-api-foundation.md` and `2026-08-31-scheduling.md`, both complete and merged to `main`. 413 tests passing.

## Global Constraints

- Node 22, npm 10, npm workspaces. New package: `@simple-todos/web`.
- TypeScript strict, ESM. **Relative imports in API/shared code carry a `.js` extension**; Vite-bundled app code under `apps/web/src` does not need them (Vite resolves TS/TSX natively) — follow each side's own convention.
- **Every request and response shape comes from `@simple-todos/shared`.** No hand-written duplicate types in the web app. If a shape is missing, add it to shared rather than inventing a local one.
- **Zero `as never` casts in `apps/api/src`.** There are none; keep it that way.
- Authentication is not opt-in: route plugins register inside the encapsulated authenticated scope in `apps/api/src/http/app.ts`. `apps/api/src/http/authScope.test.ts` asserts the only open routes are `GET /api/health` and `POST /api/auth/login` — **Task 1 changes how that test discovers routes, and after that it must never be weakened again.**
- The bearer token lives in `localStorage`; a 401 from any request clears it and returns to login.
- Timestamps arrive as ISO-8601 UTC and are rendered in the user's `settings.timezone`. Date-only fields are already `YYYY-MM-DD` in that zone — never re-convert them.
- Priorities are `'must' | 'should' | 'could'`, shown as **Must / Should / Could**.
- Accessibility floor, not negotiable: visible keyboard focus, labelled controls, `prefers-reduced-motion` respected, responsive to 360px.
- TDD: failing test first, watch it fail, implement, watch it pass, commit.
- **Build ordering:** `@simple-todos/shared` resolves to its compiled `dist/`. Run `npm run build:shared` after editing anything under `packages/shared/`.

---

## Design direction

The client is one person's private instrument on their own server. The thing that
makes this app itself is that **the day is the unit of work**: completed tasks
stay struck through until the 3AM sweep files them, habits build streaks day by
day, the archive groups by day.

**Signature — the day spine.** A fixed left rail carrying today's date set large,
the five destinations, and a live countdown to the next sweep. It states the
app's central mechanic on every screen. On narrow viewports it collapses to a
header band.

**Tokens** (define once in `apps/web/src/styles/tokens.css`, derive everything):

| Token | Value | Role |
|---|---|---|
| `--ink` | `#1B1D1A` | text, near-black with a green cast |
| `--paper` | `#EDEAE3` | ground, warm grey — deliberately not cream |
| `--paper-raised` | `#F5F3EE` | cards, inputs |
| `--rule` | `#D4CFC4` | ledger rules, borders |
| `--ai` | `#28407A` | the only accent: Japanese indigo |
| `--ai-soft` | `#E4E8F2` | selected rows, focus wash |
| `--dim` | `#6E6A61` | secondary text |
| `--strike` | `#9A958A` | completed-but-unswept text |
| `--warn` | `#8A3324` | overdue and missed only — never decorative |

**Type.** `Fraunces` for dates and the spine only, used with restraint;
`Public Sans` for all UI text; `ui-monospace, SFMono-Regular, Menlo, monospace`
for data that should align (times, streak strips, counts). Load the two webfonts
from Google Fonts with a real fallback stack.

**Priority is encoded as left-rule weight, not colour.** Must is a 3px `--ai`
rule, Should a 1px `--rule`, Could none plus `--dim` text. The three levels are
ordered, and weight encodes order where colour cannot; it also keeps the page a
ledger rather than a Kanban board. Every priority is additionally labelled in
text, so the encoding is never the only channel.

**Restraint.** One accent, one display face, one signature. Motion is limited to
a 120ms ease on hover/focus and the spine countdown ticking; everything else is
static. `prefers-reduced-motion: reduce` disables all of it.

---

## File Structure

**`apps/api`** (Task 1 only)

| File | Responsibility |
|---|---|
| `src/http/app.ts` | accepts an optional `onRoute` observer; registers `@fastify/static` in production |
| `src/http/authScope.test.ts` | discovers routes from the observer instead of parsing `printRoutes` |

**`apps/web`**

| File | Responsibility |
|---|---|
| `index.html`, `vite.config.ts`, `tsconfig.json` | app shell and build |
| `src/main.tsx` | mount, QueryClient, router |
| `src/api/client.ts` | typed fetch, bearer header, 401 handling, error envelope |
| `src/api/hooks.ts` | one TanStack Query hook per endpoint |
| `src/auth/session.ts` | token storage and the `useSession` hook |
| `src/auth/LoginScreen.tsx` | the only unauthenticated screen |
| `src/styles/tokens.css`, `src/styles/base.css` | design tokens and element defaults |
| `src/shell/AppShell.tsx` | the day spine, nav, outlet |
| `src/shell/SweepCountdown.tsx` | live time until the next sweep |
| `src/screens/ActiveScreen.tsx` | the task tree |
| `src/screens/ArchiveScreen.tsx` | three groupings |
| `src/screens/RepeatablesScreen.tsx` | habits and history strips |
| `src/screens/NotesScreen.tsx` | notes across active and archived |
| `src/screens/SettingsScreen.tsx` | timezone, sweep, reminder, categories, password |
| `src/components/*` | `TaskRow`, `PriorityRule`, `CategoryChip`, `Field`, `EmptyState` |

---

### Task 1: Serve the SPA, and make the auth guard able to see a wildcard

The route-table guard parses `printRoutes` ASCII output. find-my-way discards a
wildcard route's prefix when printing, so `/api/*` renders as a bare top-level
`*` and its real path is unrecoverable. `@fastify/static` registers exactly such
a route. Fixing the guard is a prerequisite for serving the SPA at all, and it
comes first so the rest of the plan cannot quietly ship an open endpoint.

**Files:**
- Modify: `apps/api/src/http/app.ts`, `apps/api/src/http/authScope.test.ts`, `apps/api/package.json`
- Test: `apps/api/src/http/staticSpa.test.ts`

**Interfaces:**
- Consumes: `buildAppWithServices(deps)`, `AppDeps`.
- Produces: `AppDeps.onRoute?: (route: {method: string; url: string}) => void`, called for every route as it registers. `AppDeps.staticRoot?: string` — when set, the SPA is served from it.

- [ ] **Step 1: Replace the guard's route discovery, and watch it still pass**

In `apps/api/src/http/app.ts`, add to `AppDeps`:

```ts
  /**
   * Called for every route as it is registered. Exists because the auth guard
   * needs a real route table: Fastify's printRoutes discards a wildcard's
   * prefix, and an onRoute hook added after `register()` boots is too late to
   * see anything.
   */
  onRoute?: (route: { method: string; url: string }) => void;
```

and immediately after the Fastify instance is created, before any `register`:

```ts
  if (deps.onRoute) {
    const observe = deps.onRoute;
    app.addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) observe({ method, url: route.url });
    });
  }
```

Then rewrite `listRoutes` in `apps/api/src/http/authScope.test.ts` to build the
app itself with an observer, deleting the `printRoutes` parsing entirely:

```ts
async function discoverRoutes(): Promise<Route[]> {
  const routes: Route[] = [];
  const ctx = await makeTestApp(undefined, {
    onRoute: ({ method, url }) => {
      // HEAD is Fastify's automatic shadow of GET on the same hook chain.
      if (method !== 'HEAD') routes.push({ method: method as HTTPMethods, path: url });
    },
  });
  await ctx.close();
  return routes;
}
```

`makeTestApp` needs to forward extra `AppDeps`; give it an optional second
parameter `extra?: Partial<AppDeps>` spread into the `buildApp` call. Keep the
allowlist, the set-equality assertion, and the unauthenticated-injection loop
exactly as they are — only discovery changes.

Note the test now builds a throwaway app to discover routes and a second one to
inject against; that is fine and keeps discovery honest.

- [ ] **Step 2: Prove the guard catches a wildcard**

Temporarily register `app.get('/api/leak/*', ...)` **outside** the authenticated
scope, run `npx vitest run apps/api/src/http/authScope.test.ts`, and confirm the
failure names `GET /api/leak/*` — the full path, not a bare `*`. Remove the
temporary route. Paste the failure output into your report: this is the whole
point of the task.

- [ ] **Step 3: Write the failing SPA-serving test**

`apps/api/src/http/staticSpa.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';

let ctx: TestApp;
let root: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'spa-'));
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>simple-todos</title>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
  ctx = await makeTestApp(undefined, { staticRoot: root });
});

afterEach(async () => {
  await ctx.close();
  rmSync(root, { recursive: true, force: true });
});

describe('serving the SPA', () => {
  it('serves index.html at the root', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('simple-todos');
  });

  it('serves a built asset', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(res.statusCode).toBe(200);
  });

  it('falls back to index.html for a client route, so deep links work', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/archive' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('simple-todos');
  });

  it('does NOT swallow unknown API routes into the SPA', async () => {
    // A 404 under /api must stay a JSON 404, or every client bug becomes a
    // confusing page of HTML.
    const res = await ctx.app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('still requires a token for an authenticated API route', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/tasks' })).statusCode).toBe(401);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run apps/api/src/http/staticSpa.test.ts`
Expected: FAIL — `/` returns the JSON 404 envelope.

- [ ] **Step 5: Implement static serving**

```bash
npm i -w @simple-todos/api @fastify/static
```

In `buildAppWithServices`, after the authenticated scope is registered:

```ts
  if (deps.staticRoot) {
    await app.register(fastifyStatic, { root: deps.staticRoot, wildcard: false });

    // A client-side route such as /archive is not a file; serve the shell and
    // let the router take over. Anything under /api that reached here is a
    // genuine 404 and must stay JSON, or a typo in a fetch returns a page of
    // HTML instead of an error a client can read.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'route not found' } });
        return;
      }
      reply.sendFile('index.html');
    });
  }
```

`registerErrorHandler` already installs a not-found handler; this one replaces it
only when `staticRoot` is set, so the API-only path is untouched. Import
`fastifyStatic from '@fastify/static'`. Add `staticRoot?: string` to `AppDeps`.

- [ ] **Step 6: Run both tests and the whole suite**

```bash
npx vitest run apps/api/src/http/staticSpa.test.ts apps/api/src/http/authScope.test.ts
npm test && npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: serve the SPA and give the auth guard a real route table"
```

---

### Task 2: The web app, its API client, and login

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `src/main.tsx`, `src/api/client.ts`, `src/auth/session.ts`, `src/auth/LoginScreen.tsx`
- Create: `src/styles/tokens.css`, `src/styles/base.css`
- Modify: root `package.json`, `vitest.config.ts`
- Test: `src/api/client.test.ts`, `src/auth/LoginScreen.test.tsx`

**Interfaces:**
- Consumes: `@simple-todos/shared` schemas; the API at `/api`.
- Produces: `ApiError` (with `code`, `message`, `status`), `apiFetch<T>(path, init?, schema?): Promise<T>`, `setToken(t)/getToken()/clearToken()`, `useSession()` returning `{token, login, logout}`.

- [ ] **Step 1: Scaffold the package**

`apps/web/package.json`:

```json
{
  "name": "@simple-todos/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@simple-todos/shared": "*",
    "@tanstack/react-query": "^5.90.2",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router-dom": "^7.9.3"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^5.0.4",
    "jsdom": "^27.0.0",
    "vite": "^7.1.9"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

The base config uses `NodeNext`; the web app overrides to `bundler` because Vite
resolves imports, and `NodeNext` would demand `.js` suffixes on every relative
import in JSX.

`apps/web/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in development too, so nothing needs CORS and the token
    // handling matches production exactly.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>simple-todos</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Public+Sans:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Add to the root `package.json` scripts: `"dev:web": "npm run dev -w @simple-todos/web"`, and extend `build` to `npm run build -w @simple-todos/shared && npm run build -w @simple-todos/api && npm run build -w @simple-todos/web`.

Then `npm install`.

- [ ] **Step 2: Add a jsdom project to vitest**

Replace `vitest.config.ts` at the root:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['packages/**/*.test.ts', 'apps/api/**/*.test.ts'],
          environment: 'node',
          hookTimeout: 30000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          include: ['apps/web/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['apps/web/test/setup.ts'],
        },
      },
    ],
  },
});
```

`apps/web/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

If the installed vitest predates `projects`, use `workspace` with the same two
entries — check its version rather than guessing.

- [ ] **Step 3: Write the failing client test**

`apps/web/src/api/client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, apiFetch } from './client';
import { clearToken, getToken, setToken } from '../auth/session';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  clearToken();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('prefixes /api and returns the parsed body', async () => {
    const fetchMock = mockFetch(200, { status: 'ok' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/health')).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything());
  });

  it('sends the bearer token when one is stored', async () => {
    setToken('t0ken');
    const fetchMock = mockFetch(200, {});
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/tasks');

    const init = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer t0ken');
  });

  it('sends no authorization header when there is no token', async () => {
    const fetchMock = mockFetch(200, {});
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/health');

    const init = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('throws ApiError carrying the envelope code and status', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { error: { code: 'CONFLICT', message: 'that move would create a cycle' } }));

    await expect(apiFetch('/tasks/x/move')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: 'that move would create a cycle',
    });
  });

  it('clears the stored token on 401, so a stale session cannot loop', async () => {
    setToken('stale');
    vi.stubGlobal('fetch', mockFetch(401, { error: { code: 'UNAUTHENTICATED', message: 'invalid or expired token' } }));

    await expect(apiFetch('/tasks')).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toBeNull();
  });

  it('survives an error body that is not the envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 502,
      ok: false,
      json: async () => {
        throw new Error('not json');
      },
    })) as unknown as typeof fetch);

    await expect(apiFetch('/tasks')).rejects.toMatchObject({ code: 'INTERNAL', status: 502 });
  });

  it('returns undefined for 204, rather than trying to parse a body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 204, ok: true, json: async () => { throw new Error('no body'); } })) as unknown as typeof fetch);
    await expect(apiFetch('/tasks/x')).resolves.toBeUndefined();
  });

  it('validates against a schema when given one', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { wrong: true }));
    await expect(apiFetch('/settings', undefined, z.object({ timezone: z.string() }))).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run apps/web/src/api/client.test.ts`
Expected: FAIL — cannot resolve `./client`.

- [ ] **Step 5: Implement session and client**

`apps/web/src/auth/session.ts`:

```ts
const KEY = 'simple-todos.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // Private-mode browsers can throw on access; treat as signed out.
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* nothing to do — the session lasts only this page */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
```

`apps/web/src/api/client.ts`:

```ts
import type { ErrorCodeValue } from '@simple-todos/shared';
import type { ZodType } from 'zod';
import { clearToken, getToken } from '../auth/session';

export class ApiError extends Error {
  readonly code: ErrorCodeValue;
  readonly status: number;

  constructor(code: ErrorCodeValue, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Every call the app makes. Adds the bearer token, unwraps the error envelope,
 * and optionally validates the response against the shared contract.
 */
export async function apiFetch<T>(path: string, init?: RequestInit, schema?: ZodType<T>): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(init?.body ? { 'content-type': 'application/json' } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`/api${path}`, { ...init, headers });

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    // A 401 means the token is gone or stale; drop it so the app returns to
    // login instead of retrying forever with a credential that cannot work.
    if (res.status === 401) clearToken();

    let code: ErrorCodeValue = 'INTERNAL';
    let message = `request failed with ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: ErrorCodeValue; message?: string } };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      /* not the envelope — keep the defaults */
    }
    throw new ApiError(code, message, res.status);
  }

  const body = (await res.json()) as unknown;
  return schema ? schema.parse(body) : (body as T);
}
```

- [ ] **Step 6: Run the client tests and watch them pass**

Run: `npx vitest run apps/web/src/api/client.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 7: Write the design tokens**

`apps/web/src/styles/tokens.css`:

```css
:root {
  --ink: #1b1d1a;
  --paper: #edeae3;
  --paper-raised: #f5f3ee;
  --rule: #d4cfc4;
  --ai: #28407a;
  --ai-soft: #e4e8f2;
  --dim: #6e6a61;
  --strike: #9a958a;
  --warn: #8a3324;

  --font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
  --font-ui: 'Public Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-data: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  --step--1: 0.812rem;
  --step-0: 0.938rem;
  --step-1: 1.125rem;
  --step-2: 1.5rem;
  --step-3: 2.25rem;
  --step-4: 3.5rem;

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.875rem;
  --space-4: 1.375rem;
  --space-5: 2.25rem;

  --spine-width: 13rem;
  --radius: 3px;
  --motion: 120ms ease;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --motion: 0ms;
  }
}
```

`apps/web/src/styles/base.css`:

```css
@import './tokens.css';

*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: var(--step-0);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

:focus-visible {
  outline: 2px solid var(--ai);
  outline-offset: 2px;
}

button {
  font: inherit;
  color: inherit;
  cursor: pointer;
}

input,
select,
textarea {
  font: inherit;
  color: inherit;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  padding: var(--space-2) var(--space-3);
}

.data {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
```

- [ ] **Step 8: Write the failing login test**

`apps/web/src/auth/LoginScreen.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginScreen } from './LoginScreen';
import { clearToken, getToken } from './session';

beforeEach(() => clearToken());
afterEach(() => vi.unstubAllGlobals());

function stub(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ status, ok: status < 400, json: async () => body })) as unknown as typeof fetch,
  );
}

describe('LoginScreen', () => {
  it('labels both fields', () => {
    render(<LoginScreen onSignedIn={() => {}} />);
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('stores the token and reports success', async () => {
    stub(200, { token: 'abc', expiresAt: '2026-12-01T00:00:00.000Z' });
    const onSignedIn = vi.fn();
    render(<LoginScreen onSignedIn={onSignedIn} />);

    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'admin');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(getToken()).toBe('abc');
    expect(onSignedIn).toHaveBeenCalled();
  });

  it('shows the failure without saying which half was wrong', async () => {
    stub(401, { error: { code: 'UNAUTHENTICATED', message: 'invalid credentials' } });
    render(<LoginScreen onSignedIn={() => {}} />);

    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/credentials/i);
    expect(alert.textContent).not.toMatch(/username|password/i);
    expect(getToken()).toBeNull();
  });

  it('tells the user plainly when they are being rate limited', async () => {
    stub(429, { error: { code: 'RATE_LIMITED', message: 'too many requests' } });
    render(<LoginScreen onSignedIn={() => {}} />);

    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'admin');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });
});
```

- [ ] **Step 9: Implement `LoginScreen` and `main.tsx`**

`apps/web/src/auth/LoginScreen.tsx`:

```tsx
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
      <h1 className="login__mark">simple&#8203;todos</h1>
      <p className="login__sub">Your list, on your own server.</p>

      <form onSubmit={submit} className="login__form">
        <label htmlFor="username">Username</label>
        <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />

        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />

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
```

Style it in `apps/web/src/styles/base.css` (or a co-located `login.css` imported
by the component — pick one convention and keep it): centred column, max-width
`22rem`, the mark in `--font-display` at `--step-3`, the error in `--warn`.

`apps/web/src/main.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/base.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 5_000 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
```

`retry: false` matters: a 401 must reach the app immediately so it can return to
login, not be retried three times first.

`apps/web/src/App.tsx` for now just switches on the token:

```tsx
import { useState } from 'react';
import { LoginScreen } from './auth/LoginScreen';
import { getToken } from './auth/session';

export function App() {
  const [token, setTokenState] = useState(getToken());
  if (!token) return <LoginScreen onSignedIn={() => setTokenState(getToken())} />;
  return <p>Signed in.</p>;
}
```

Task 3 replaces the signed-in branch with the shell.

- [ ] **Step 10: Run everything and commit**

```bash
npm run build:shared && npm test && npm run typecheck
git add -A
git commit -m "feat: scaffold the web app with its API client and login"
```

---

### Task 3: The app shell and the day spine

The signature element. Everything else hangs off it.

**Files:**
- Create: `src/shell/AppShell.tsx`, `src/shell/SweepCountdown.tsx`, `src/shell/shell.css`
- Create: `src/api/hooks.ts`
- Modify: `src/App.tsx`
- Test: `src/shell/SweepCountdown.test.tsx`, `src/shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `Settings`, `MeResponse`.
- Produces: `useSettings()`, `useMe()` query hooks. `timeUntilSweep(now: Date, sweepTime: string, timeZone: string): {hours: number; minutes: number}`. `<AppShell>` with react-router `<Outlet/>`.

- [ ] **Step 1: Write the failing countdown test**

`apps/web/src/shell/SweepCountdown.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { timeUntilSweep } from './SweepCountdown';

const JST = 'Asia/Tokyo';

describe('timeUntilSweep', () => {
  it('counts the hours and minutes to the next sweep', () => {
    // 2026-09-01T13:00Z is 22:00 JST; the 03:00 sweep is 5 hours away.
    expect(timeUntilSweep(new Date('2026-09-01T13:00:00Z'), '03:00', JST)).toEqual({ hours: 5, minutes: 0 });
  });

  it('rolls to tomorrow once today sweep time has passed', () => {
    // 04:00 JST, just after the sweep — the next one is 23 hours away.
    expect(timeUntilSweep(new Date('2026-09-01T19:00:00Z'), '03:00', JST)).toEqual({ hours: 23, minutes: 0 });
  });

  it('handles a partial hour', () => {
    // 01:23 JST → 1h37m to 03:00.
    expect(timeUntilSweep(new Date('2026-08-31T16:23:00Z'), '03:00', JST)).toEqual({ hours: 1, minutes: 37 });
  });

  it('honours a different configured sweep time', () => {
    expect(timeUntilSweep(new Date('2026-09-01T13:00:00Z'), '23:30', JST)).toEqual({ hours: 1, minutes: 30 });
  });

  it('works in a zone other than the browser own', () => {
    // 22:00 UTC with a 03:00 UTC sweep is 5 hours, independent of the host TZ.
    expect(timeUntilSweep(new Date('2026-09-01T22:00:00Z'), '03:00', 'UTC')).toEqual({ hours: 5, minutes: 0 });
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then implement**

`apps/web/src/shell/SweepCountdown.tsx`:

```tsx
import { useEffect, useState } from 'react';

/** Wall-clock 'HH:MM' in a zone, matching how the API compares these. */
function localParts(at: Date, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { hour: get('hour'), minute: get('minute') };
}

/**
 * How long until the next sweep files today's finished work away.
 *
 * Pure minute arithmetic in the user's zone — no date construction, so a DST
 * transition cannot shift the answer by an hour.
 */
export function timeUntilSweep(
  now: Date,
  sweepTime: string,
  timeZone: string,
): { hours: number; minutes: number } {
  const [sweepHour, sweepMinute] = sweepTime.split(':').map(Number) as [number, number];
  const { hour, minute } = localParts(now, timeZone);

  let delta = sweepHour * 60 + sweepMinute - (hour * 60 + minute);
  if (delta <= 0) delta += 24 * 60;

  return { hours: Math.floor(delta / 60), minutes: delta % 60 };
}

export function SweepCountdown({ sweepTime, timeZone }: { sweepTime: string; timeZone: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const { hours, minutes } = timeUntilSweep(now, sweepTime, timeZone);

  return (
    <p className="spine__sweep">
      <span className="spine__sweep-label">Filing away in</span>
      <span className="spine__sweep-value data">
        {hours}h {String(minutes).padStart(2, '0')}m
      </span>
    </p>
  );
}
```

- [ ] **Step 3: Add the query hooks**

`apps/web/src/api/hooks.ts` — start with the two the shell needs; later tasks
append to this file:

```ts
import { MeResponse, Settings } from '@simple-todos/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => apiFetch('/auth/me', undefined, MeResponse) });
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => apiFetch('/settings', undefined, Settings) });
}
```

- [ ] **Step 4: Write the failing shell test**

`apps/web/src/shell/AppShell.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import { setToken } from '../auth/session';

afterEach(() => vi.unstubAllGlobals());

function renderShell() {
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
          <Route element={<AppShell onSignedOut={() => {}} />}>
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

  it('offers a way to sign out', async () => {
    renderShell();
    expect(await screen.findByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('marks the current destination for assistive tech', async () => {
    renderShell();
    const active = await screen.findByRole('link', { name: /active/i });
    expect(active).toHaveAttribute('aria-current', 'page');
  });
});
```

- [ ] **Step 5: Implement `AppShell` and wire the router**

`apps/web/src/shell/AppShell.tsx` renders the spine (today's date in
`--font-display` at `--step-4` over the month and weekday in `--font-data`), the
five `NavLink`s, `SweepCountdown` when settings have loaded, a sign-out button
that calls `clearToken()` then `onSignedOut()`, and `<Outlet/>`. Give the nav an
`aria-label="Sections"`. Import `./shell.css`.

`apps/web/src/shell/shell.css` implements the layout:

```css
.shell {
  display: grid;
  grid-template-columns: var(--spine-width) minmax(0, 1fr);
  min-height: 100vh;
}

.spine {
  border-right: 1px solid var(--rule);
  padding: var(--space-5) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  position: sticky;
  top: 0;
  height: 100vh;
}

.spine__day {
  font-family: var(--font-display);
  font-size: var(--step-4);
  font-variation-settings: 'SOFT' 40, 'WONK' 1;
  line-height: 0.85;
  letter-spacing: -0.02em;
}

.spine__month {
  font-family: var(--font-data);
  font-size: var(--step--1);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--dim);
}

.spine__nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.spine__nav a {
  color: var(--dim);
  text-decoration: none;
  padding: var(--space-1) 0;
  border-left: 2px solid transparent;
  padding-left: var(--space-3);
  transition: color var(--motion), border-color var(--motion);
}

.spine__nav a:hover {
  color: var(--ink);
}

.spine__nav a[aria-current='page'] {
  color: var(--ink);
  border-left-color: var(--ai);
  font-weight: 600;
}

.spine__sweep {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.spine__sweep-label {
  font-size: var(--step--1);
  color: var(--dim);
}

.spine__sweep-value {
  font-size: var(--step-1);
  color: var(--ai);
}

.content {
  padding: var(--space-5);
  max-width: 56rem;
}

@media (max-width: 46rem) {
  .shell {
    grid-template-columns: 1fr;
  }
  .spine {
    position: static;
    height: auto;
    border-right: none;
    border-bottom: 1px solid var(--rule);
    flex-direction: row;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }
  .spine__day {
    font-size: var(--step-2);
  }
  .spine__nav {
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .spine__nav a {
    border-left: none;
    border-bottom: 2px solid transparent;
    padding-left: 0;
  }
  .spine__nav a[aria-current='page'] {
    border-left-color: transparent;
    border-bottom-color: var(--ai);
  }
  .spine__sweep {
    margin-top: 0;
    flex-direction: row;
    gap: var(--space-2);
    align-items: baseline;
  }
  .content {
    padding: var(--space-4);
  }
}
```

Replace `apps/web/src/App.tsx` with a `BrowserRouter` whose routes are `/`
(Active), `/archive`, `/repeating`, `/notes`, `/settings`, all nested under
`AppShell`, with `LoginScreen` shown when there is no token. Later tasks fill in
the screens; for now point each at a placeholder that renders its own name.

- [ ] **Step 6: Run everything and commit**

```bash
npm test && npm run typecheck
git add -A
git commit -m "feat: add the app shell and the day spine"
```

---

### Task 4: The Active screen

**Files:**
- Create: `src/screens/ActiveScreen.tsx`, `src/components/TaskRow.tsx`, `src/components/PriorityRule.tsx`, `src/components/CategoryChip.tsx`, `src/screens/screens.css`
- Modify: `src/api/hooks.ts`, `src/App.tsx`
- Test: `src/screens/ActiveScreen.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `TaskNode`, `CreateTaskRequest`, `Category`.
- Produces: `useTasks(filter)`, `useCategories()`, `useCreateTask()`, `useCompleteTask()`, `useUncompleteTask()`, `useDeleteTask()` hooks. `<TaskRow task depth onToggle onDelete>`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/screens/ActiveScreen.test.tsx` — build a stub fetch returning a
two-level tree with one completed sibling, then assert:

```tsx
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

function renderScreen(onFetch?: (url: string, init?: RequestInit) => unknown) {
  setToken('t');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      onFetch?.(url, init);
      if (url.includes('/categories')) return { status: 200, ok: true, json: async () => [] };
      return { status: 200, ok: true, json: async () => tree };
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
    // It stays on screen until the sweep — that is the whole point.
    expect(screen.getByText('Book flights')).toBeInTheDocument();
  });

  it('labels the priority in text, not only by the rule weight', async () => {
    renderScreen();
    expect(await screen.findByText(/must/i)).toBeInTheDocument();
  });

  it('shows the deadline when there is one', async () => {
    renderScreen();
    expect(await screen.findByText(/2026-09-20/)).toBeInTheDocument();
  });

  it('completes a task through the API when its box is ticked', async () => {
    const calls: { url: string; method?: string }[] = [];
    renderScreen((url, init) => calls.push({ url, method: init?.method }));

    await userEvent.click(await screen.findByRole('checkbox', { name: /plan kyoto trip/i }));

    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/complete') && c.method === 'POST')).toBe(true),
    );
  });

  it('unticks through the uncomplete endpoint', async () => {
    const calls: { url: string; method?: string }[] = [];
    renderScreen((url, init) => calls.push({ url, method: init?.method }));

    await userEvent.click(await screen.findByRole('checkbox', { name: /book flights/i }));

    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/uncomplete') && c.method === 'POST')).toBe(true),
    );
  });

  it('adds a task', async () => {
    const calls: { url: string; method?: string }[] = [];
    renderScreen((url, init) => calls.push({ url, method: init?.method }));

    await userEvent.type(await screen.findByLabelText(/add a task/i), 'Buy oat milk{Enter}');

    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/api/tasks') && c.method === 'POST')).toBe(true),
    );
  });

  it('invites action when the list is empty', async () => {
    setToken('t');
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true, json: async () => [] })) as unknown as typeof fetch);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ActiveScreen />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/nothing on the list/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then implement**

Add the mutation hooks to `src/api/hooks.ts`, each invalidating `['tasks']` on
success so the tree refetches. `ActiveScreen` renders a heading, an add-task
input (label "Add a task", submits on Enter), category and priority filter
selects bound to `TaskFilter`, and the recursive tree.

`TaskRow` renders a checkbox whose accessible name is the task title, the title,
a `PriorityRule` (a `<span aria-hidden>` for the rule plus the visible label
text), the category chip, the due date in `.data`, and a delete button. A
completed task gets `text-decoration: line-through` and `color: var(--strike)`.
An overdue date gets `color: var(--warn)`.

Key CSS in `screens.css`:

```css
.task {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid transparent;
}

/* Priority is encoded as rule weight, not colour: the three levels are ordered,
   and weight carries order where hue cannot. Always paired with a text label. */
.task--must {
  border-left-color: var(--ai);
}
.task--should {
  border-left: 1px solid var(--rule);
  padding-left: calc(var(--space-3) + 2px);
}
.task--could {
  color: var(--dim);
}

.task--done .task__title {
  text-decoration: line-through;
  color: var(--strike);
}

.task__due {
  font-size: var(--step--1);
  color: var(--dim);
}
.task__due--overdue {
  color: var(--warn);
}
```

Nest children by rendering `TaskRow` recursively inside a `<ul>` with
`padding-left: var(--space-4)`.

- [ ] **Step 3: Run everything and commit**

```bash
npm test && npm run typecheck
git add -A
git commit -m "feat: add the Active screen"
```

---

### Task 5: The Archive screen

**Files:**
- Create: `src/screens/ArchiveScreen.tsx`
- Modify: `src/api/hooks.ts`, `src/App.tsx`
- Test: `src/screens/ArchiveScreen.test.tsx`

**Interfaces:**
- Consumes: `ArchiveResponse`, `ArchiveGroupBy`.
- Produces: `useArchive(query)`.

- [ ] **Step 1: Write the failing test**

Assert: the default grouping is `parent` and renders nested trees; switching the
grouping select to "Completed date" refetches with `groupBy=completed` and
renders flat date groups; every row shows **both** its added and completed dates;
an empty archive explains *why* it is empty rather than just saying "no results".

The empty-state copy matters and is asserted: `/nothing has been filed away yet/i`
— because an empty archive on a working app is normal, not an error, and the
reason (the sweep files things overnight) is what the reader needs.

- [ ] **Step 2: Implement**

A grouping `<select>` labelled "Group by" with options Parent / Added date /
Completed date, bound to the query. For `parent`, render each group's tree the
same way `ActiveScreen` does but read-only. For the date groupings, render a
`<section>` per date with the date as an `<h2>` in `--font-display`, and a flat
list beneath. Every row shows `added <date> · done <date>` in `.data`.

Pagination: a "Show more" button appended when `nextCursor` is non-null, passing
it as `cursor`. Do not build infinite scroll.

- [ ] **Step 3: Run everything and commit**

```bash
npm test && npm run typecheck
git add -A
git commit -m "feat: add the Archive screen"
```

---

### Task 6: The Repeatables screen

**Files:**
- Create: `src/screens/RepeatablesScreen.tsx`, `src/components/HistoryStrip.tsx`
- Modify: `src/api/hooks.ts`, `src/App.tsx`
- Test: `src/screens/RepeatablesScreen.test.tsx`, `src/components/HistoryStrip.test.tsx`

**Interfaces:**
- Consumes: `Recurrence`, `CreateRecurrenceRequest`, `RecurrenceHistory`.
- Produces: `useRecurrences()`, `useCreateRecurrence()`, `useUpdateRecurrence()`, `useDeleteRecurrence()`, `useHistory(id)`. `<HistoryStrip entries>`.

- [ ] **Step 1: Write the failing HistoryStrip test**

The strip is a row of cells, one per logged occurrence, oldest to newest. Assert
it renders one cell per entry; that each cell carries an accessible label naming
the date and outcome (`2026-09-01: completed`), since colour alone must never
carry the meaning; and that an empty history renders nothing rather than an empty
box.

- [ ] **Step 2: Implement the strip**

```tsx
export function HistoryStrip({ entries }: { entries: HistoryEntryValue[] }) {
  if (entries.length === 0) return null;
  return (
    <ol className="strip" aria-label="Recent occurrences">
      {entries.map((e) => (
        <li
          key={e.date}
          className={e.status === 'completed' ? 'strip__cell strip__cell--hit' : 'strip__cell strip__cell--miss'}
        >
          <span className="visually-hidden">{`${e.date}: ${e.status}`}</span>
        </li>
      ))}
    </ol>
  );
}
```

with `.strip__cell--hit { background: var(--ai) }` and
`.strip__cell--miss { background: transparent; border: 1px solid var(--rule) }`.
A hit is filled, a miss is an outline — a difference in *fill*, legible without
colour vision.

- [ ] **Step 3: Write the failing screen test, then implement**

Assert: habits list with their schedule in words ("Every day", "Mon, Wed, Fri");
current and longest streak shown as numbers in `.data`; a create form with a kind
select and, when Weekly is chosen, seven day toggles; that submitting Weekly with
no days selected shows the API's 400 message rather than a generic failure; a
pause control that PATCHes `active:false` and visibly marks the habit paused; and
a delete control behind a confirmation that names what is lost ("Deleting removes
its history. Tasks it already created are kept.").

Render the weekday toggles as real `<input type="checkbox">` with labels, not
clickable divs.

- [ ] **Step 4: Run everything and commit**

```bash
npm test && npm run typecheck
git add -A
git commit -m "feat: add the Repeatables screen"
```

---

### Task 7: The Notes screen

**Files:**
- Create: `src/screens/NotesScreen.tsx`
- Modify: `src/api/hooks.ts`, `src/App.tsx`
- Test: `src/screens/NotesScreen.test.tsx`

**Interfaces:**
- Consumes: `NotesResponse`, `UpdateTaskRequest`.
- Produces: `useNotes(query)`, `useUpdateTask()` (shared with Active).

- [ ] **Step 1: Write the failing test**

Assert: notes render newest first with their task title, status, and both dates;
the status filter (All / Active / Archived) refetches with `status=`; the search
box refetches with `q=`; editing a note in place PATCHes `/tasks/:id` and shows
the saved text; and the empty state reads
`/notes you attach to tasks will collect here/i`.

Also assert that an **archived** note is editable — that is the point of the
screen, and a naive implementation disables editing on archived rows.

- [ ] **Step 2: Implement**

Each row is a `<article>`: the note text as an editable `<textarea>` that saves on
blur when changed, the task title as a heading, a status pill, and the dates in
`.data`. Search input labelled "Search notes"; status select labelled "Show".

Guard the save: only PATCH when the text actually differs, so blurring an
untouched note does not bump `notesUpdatedAt` and reorder the list under the
reader.

- [ ] **Step 3: Run everything and commit**

```bash
npm test && npm run typecheck
git add -A
git commit -m "feat: add the Notes screen"
```

---

### Task 8: The Settings screen

**Files:**
- Create: `src/screens/SettingsScreen.tsx`
- Modify: `src/api/hooks.ts`, `src/App.tsx`
- Test: `src/screens/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: `Settings`, `UpdateSettingsRequest`, `Category`, `ChangePasswordRequest`.
- Produces: `useUpdateSettings()`, `useCreateCategory()`, `useUpdateCategory()`, `useDeleteCategory()`, `useChangePassword()`, `useTestWebhook()`.

- [ ] **Step 1: Write the failing test**

Assert, in four labelled sections:

- **Schedule** — timezone input, sweep time, reminder toggle and time. Enabling
  the reminder with no webhook shows the API's message; the test asserts the
  message names the webhook, since that is what the reader must fix.
- **Reminders** — webhook kind select, URL field, and a "Send a test message"
  button that shows "Sent." or "Could not deliver it." based on `delivered`.
  Assert both branches: a failed delivery must not look like a success.
- **Categories** — list with rename and colour, an add form, and delete behind a
  confirmation reading "Tasks keep their place; they just lose the label."
- **Password** — current and new fields; assert a new password under 8
  characters shows the API's validation message, and that on success the app
  signs out, because the API invalidates every existing token.

That last one is the subtle case: a naive implementation leaves the user on a
dead session.

- [ ] **Step 2: Implement**

Use `<fieldset>`/`<legend>` per section. Every input has a real `<label>`.
Mutations invalidate `['settings']` or `['categories']`. On a successful password
change, call `clearToken()` and the app's sign-out path.

- [ ] **Step 3: Run everything and commit**

```bash
npm test && npm run typecheck
git add -A
git commit -m "feat: add the Settings screen"
```

---

### Task 9: Build the web app into the image, and run it

**Files:**
- Modify: `apps/api/Dockerfile`, `apps/api/src/server.ts`, `apps/api/src/config.ts`, `README.md`
- Test: `apps/api/src/config.test.ts`

**Interfaces:**
- Consumes: `AppDeps.staticRoot` (Task 1), `loadConfig`.
- Produces: `Config.staticRoot: string | null` from `STATIC_ROOT`; the image serves the SPA.

- [ ] **Step 1: Add `STATIC_ROOT` to config, test first**

Append to `apps/api/src/config.test.ts`: it defaults to `null`; a supplied path
is passed through. Then add `STATIC_ROOT: z.string().optional()` to the env
schema and `staticRoot: parsed.STATIC_ROOT ?? null` to the returned config, with
`staticRoot: string | null` on the interface.

In `server.ts`, pass `staticRoot: config.staticRoot ?? undefined` into
`buildAppWithServices`.

- [ ] **Step 2: Add the web build stage to the Dockerfile**

In the `build` stage, after the shared and api builds:

```dockerfile
COPY apps/web ./apps/web
RUN npm run build -w @simple-todos/web
```

and copy `apps/web/package.json` in the `deps` and `prod-deps` stages alongside
the others so `npm ci` resolves the workspace. In `runtime`:

```dockerfile
COPY --from=build /repo/apps/web/dist ./apps/web/dist
ENV STATIC_ROOT=/repo/apps/web/dist
```

Note `apps/web`'s dependencies are all `devDependencies` except React; the SPA is
compiled to static files, so **nothing from `apps/web` needs to exist in
`prod-deps`** — only its built output is copied.

- [ ] **Step 3: Build and actually run it**

```bash
docker build -f apps/api/Dockerfile -t simple-todos:web .
docker run --rm -d --name st-web -p 3002:3000 \
  -e AUTH_USERNAME=admin -e AUTH_PASSWORD=admin \
  -e JWT_SECRET=0123456789012345678901234567890123456789 \
  -v st-web-data:/data simple-todos:web
```

Verify and paste the real output into your report:

```bash
curl -s localhost:3002/api/health
curl -s localhost:3002/ | head -5              # the SPA shell
curl -s -o /dev/null -w '%{http_code}\n' localhost:3002/archive   # 200, deep link
curl -s -o /dev/null -w '%{http_code}\n' localhost:3002/api/nope  # 404, still JSON
curl -s -o /dev/null -w '%{http_code}\n' localhost:3002/api/tasks # 401, still guarded
docker stop st-web && docker volume rm st-web-data
```

If the SPA loads but the API 404s as HTML, the not-found handler ordering is
wrong — fix it rather than adjusting the test.

- [ ] **Step 4: Drive the real UI in a browser**

Start the container, open it, sign in as `admin`/`admin`, and walk each screen:
add a nested task, complete it, check the Archive explains itself when empty,
create a daily habit, add a note, and open Settings. Take a screenshot of the
Active screen and look at it. A blank frame or unstyled text is a failure, not a
pass. Report what you saw.

- [ ] **Step 5: Update the README and commit**

Document `npm run dev:web` (Vite on 5173 proxying to the API on 3000) and that
the production image serves the SPA and the API from one origin.

```bash
npm test && npm run typecheck
git add -A
git commit -m "feat: build the web client into the image"
```

---

## Plan Self-Review

**Spec coverage.** §7's five screens map to Tasks 4–8; the login route and
`localStorage` token with 401-returns-to-login are Task 2; §3.2's
`@fastify/static` half is Tasks 1 and 9.

**Gaps found and closed while writing.**
- The plan originally left the wildcard guard problem to "somewhere in Task 9".
  Moved to Task 1 and made it the first thing, because every later task adds
  routes and the guard has to be trustworthy before that, not after.
- Nothing in the spec says what happens to the session after a password change.
  The API invalidates every token, so Task 8 signs the user out explicitly rather
  than leaving them on a dead session.
- The spec does not mention SPA deep links. Task 1's not-found handler serves the
  shell for non-`/api` paths and keeps `/api` 404s as JSON, with a test for each.

**Placeholder scan.** Tasks 5–8 describe their tests by the behaviour asserted
rather than pasting full component code, because the components do not exist yet
and inventing their exact markup here would be fiction the implementer has to
fight. Every one of those tasks names its exact assertions, its empty-state copy,
and the subtle case a naive implementation gets wrong. Tasks 1–4 and 9, where the
shapes are already fixed, carry literal code.

**Type consistency.** `apiFetch<T>(path, init?, schema?)` has one signature
throughout. Hooks are named `use<Thing>` for queries and `use<Verb><Thing>` for
mutations. `AppDeps` gains exactly two optional fields, `onRoute` and
`staticRoot`, both used only by tests and by `server.ts`.

**Risk worth naming.** The design encodes priority as rule weight rather than
colour. It is the one deliberate risk, it is always paired with a text label so
the encoding is never the sole channel, and if it proves hard to scan in use the
fallback is to add a colour to `--must` only — not to abandon the ledger look.
