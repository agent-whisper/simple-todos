# simple-todos — Design

**Date:** 2026-08-31
**Status:** Approved, ready for implementation planning

## 1. Purpose

A personal todo app for a single user, self-hosted as a Docker container on a
home NAS. The web UI is the first client; a native desktop or mobile client is
expected later, so the backend is a standalone HTTP API with no
browser-specific concessions.

Beyond ordinary todo-list features, it supports nested tasks, optional
deadlines, three priority levels, user-managed categories, per-task notes,
repeatable tasks with hit/miss history, an overnight sweep that archives
finished work, and an optional daily reminder pushed to a Discord or Slack
webhook.

## 2. Non-goals

- Multiple users, sharing, or permissions. One credential pair, one dataset.
- Offline-first sync or conflict resolution.
- Full-text search. A `LIKE` filter is sufficient at this scale.
- Real-time updates between clients. Clients poll or refetch.
- Calendar integration, attachments, time tracking, tags beyond one category.

## 3. Architecture

### 3.1 Repository layout

npm workspaces monorepo (Node 22, npm 10):

```
packages/shared/    Zod schemas + inferred TS types: the API contract
apps/api/           Fastify + Drizzle + better-sqlite3 + scheduler
apps/web/           React + Vite + TanStack Query
docker/             Dockerfile, compose.yml
docs/               Specs and plans
```

`packages/shared` is what makes the future native client cheap. Every request
and response shape is a Zod schema there. The API validates with those schemas;
the web client imports the inferred types; a later desktop or mobile client
does the same. The contract has exactly one definition.

### 3.2 Deployment

One container exposing one port. In production Fastify serves the built SPA
through `@fastify/static` alongside `/api/*`, so there is no second web server
and no CORS configuration. In development Vite runs separately and proxies
`/api` to Fastify.

SQLite lives at `$DATA_DIR/todos.db` on a mounted volume, in WAL mode. The
container is stateless apart from that volume.

### 3.3 Configuration

All configuration is environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `DATA_DIR` | `/data` | Directory holding `todos.db` |
| `AUTH_USERNAME` | *(required)* | Seeds the single user on first boot |
| `AUTH_PASSWORD` | *(required)* | Seeds the password hash on first boot |
| `JWT_SECRET` | *(required)* | Signs bearer tokens |
| `DEFAULT_TZ` | `Asia/Tokyo` | Seeds `settings.timezone` on first boot |
| `LOG_LEVEL` | `info` | Pino level |

`AUTH_USERNAME` and `AUTH_PASSWORD` seed the `user` row only when it does not
exist. Afterwards the password is changed through the API, so a redeploy never
silently resets it.

### 3.4 Migrations

`drizzle-kit generate` produces SQL migration files that are committed to the
repository. On boot, before the server accepts traffic, the API runs
`migrate()` against them. Upgrades are hands-off, but the schema is reviewed in
a pull request rather than invented at runtime. A failed migration aborts
startup.

## 4. Data model

All timestamps are ISO-8601 UTC strings. Date-only fields (`due_date`,
`occurrence_date`, `run_date`) are `YYYY-MM-DD` strings interpreted in
`settings.timezone`.

### 4.1 `user`

Single row, `CHECK (id = 1)`.

- `username` TEXT NOT NULL
- `password_hash` TEXT NOT NULL — argon2id
- `token_version` INTEGER NOT NULL DEFAULT 1
- `created_at`, `updated_at`

Bumping `token_version` invalidates every issued token; a password change does
exactly that.

### 4.2 `settings`

Single row, `CHECK (id = 1)`.

- `timezone` TEXT NOT NULL DEFAULT `'Asia/Tokyo'` — IANA name
- `sweep_time` TEXT NOT NULL DEFAULT `'03:00'`
- `reminder_enabled` INTEGER NOT NULL DEFAULT 0
- `reminder_time` TEXT NOT NULL DEFAULT `'08:00'`
- `webhook_kind` TEXT CHECK IN (`'discord'`, `'slack'`), nullable
- `webhook_url` TEXT, nullable
- `updated_at`

`reminder_enabled` may only be set true when `webhook_kind` and `webhook_url`
are both present; the API rejects the combination otherwise.

### 4.3 `category`

- `id` TEXT PK (uuid)
- `name` TEXT NOT NULL — `UNIQUE INDEX ON lower(name)`
- `color` TEXT NOT NULL — hex, validated
- `position` INTEGER NOT NULL — manual ordering
- `created_at`

Deleting a category sets `category_id` to NULL on its tasks and recurrences.
Tasks are never deleted as a side effect of category deletion.

### 4.4 `task`

- `id` TEXT PK (uuid)
- `parent_id` TEXT NULL REFERENCES `task(id)` ON DELETE CASCADE
- `root_id` TEXT NOT NULL — denormalised root of the tree
- `position` INTEGER NOT NULL — ordering among siblings
- `title` TEXT NOT NULL
- `notes` TEXT NULL
- `notes_updated_at` TEXT NULL
- `priority` TEXT NOT NULL DEFAULT `'should'` CHECK IN (`'must'`, `'should'`, `'could'`)
- `category_id` TEXT NULL REFERENCES `category(id)` ON DELETE SET NULL
- `due_date` TEXT NULL
- `created_at` TEXT NOT NULL
- `completed_at` TEXT NULL
- `archived_at` TEXT NULL
- `recurrence_id` TEXT NULL REFERENCES `recurrence(id)` ON DELETE SET NULL
- `occurrence_date` TEXT NULL

Table constraints:

- `CHECK (archived_at IS NULL OR completed_at IS NOT NULL)`
- `CHECK (recurrence_id IS NULL OR occurrence_date IS NOT NULL)`

The second constraint is deliberately one-directional. Deleting a recurrence
nulls `recurrence_id` on its instances via `ON DELETE SET NULL`, leaving
`occurrence_date` behind; a symmetric constraint would make that delete fail.
An orphaned `occurrence_date` on a task with no recurrence is therefore legal
and simply records the date the task was spawned for.

Indexes:

- `(root_id)`, `(parent_id)`
- partial on `(archived_at)` where `archived_at IS NULL` — the active list
- partial on `(notes_updated_at DESC)` where `notes IS NOT NULL AND notes <> ''` — the Notes page
- partial `UNIQUE (recurrence_id, occurrence_date)` where `recurrence_id IS NOT NULL` — makes instance spawning idempotent

`root_id` is maintained by the application: on create it is the parent's
`root_id`, or the task's own id for a root. On move, the whole moved subtree is
rewritten to the new root. It exists so that "is this entire tree complete?"
and "archive this tree" are single queries rather than recursive walks.

`notes_updated_at` is stamped only when the note text actually changes, so the
Notes page orders by the note rather than by the task.

### 4.5 `recurrence`

The definition of a repeatable task.

- `id` TEXT PK (uuid)
- `title` TEXT NOT NULL
- `notes` TEXT NULL — a description of the habit
- `priority` TEXT NOT NULL DEFAULT `'should'`
- `category_id` TEXT NULL REFERENCES `category(id)` ON DELETE SET NULL
- `schedule_kind` TEXT NOT NULL CHECK IN (`'daily'`, `'weekly'`)
- `days_of_week` TEXT NULL — JSON array of ISO weekday numbers, Mon=1..Sun=7
- `active` INTEGER NOT NULL DEFAULT 1
- `last_processed_date` TEXT NOT NULL — local date through which misses have been resolved
- `created_at`, `updated_at`

Constraint: `CHECK ((schedule_kind = 'weekly') = (days_of_week IS NOT NULL))`.

`last_processed_date` is initialised to the local date of creation, so a
recurrence created today is never back-filled with misses for dates before it
existed.

`recurrence.notes` describes the habit and is **deliberately not copied onto
spawned instances**. Copying it would deposit an identical note on the Notes
page every scheduled day and drown genuine entries. Instance notes start empty
and are per-occurrence.

### 4.6 `recurrence_log`

The hit/miss history. Append-only in normal operation.

- `id` TEXT PK
- `recurrence_id` TEXT NOT NULL REFERENCES `recurrence(id)` ON DELETE CASCADE
- `occurrence_date` TEXT NOT NULL
- `status` TEXT NOT NULL CHECK IN (`'completed'`, `'missed'`)
- `completed_at` TEXT NULL
- `UNIQUE (recurrence_id, occurrence_date)`

### 4.7 `job_run`

The ledger that makes scheduled work idempotent and recoverable.

- `id` TEXT PK
- `job_name` TEXT NOT NULL CHECK IN (`'sweep'`, `'reminder'`)
- `run_date` TEXT NOT NULL — local date
- `ran_at` TEXT NOT NULL
- `UNIQUE (job_name, run_date)`

### 4.8 Invariants

The API enforces four invariants. Every one of them has a test.

1. **A complete parent implies all descendants complete.** `complete` cascades
   down; `uncomplete` cascades up the ancestor chain.
2. **Archived implies completed.** Nothing carries `archived_at` without
   `completed_at`. Enforced by a table `CHECK` as well as by code.
3. **A tree archives atomically.** Every node in a tree shares one
   `archived_at` value. Trees are never half-archived.
4. **No cycles.** A move that would make a task its own ancestor is rejected
   with 409.

## 5. Domain behaviour

### 5.1 Completion

`complete(id)` sets `completed_at = now` on the task and on every descendant
that is not already complete. If the task is a recurrence instance, it upserts
a `completed` row into `recurrence_log` for its `occurrence_date`.

`uncomplete(id)` clears `completed_at` on the task and on all of its
**ancestors**, preserving invariant 1. Descendants keep their own completion
state. If the task's tree is archived, `archived_at` is cleared across the
entire tree, returning it to the active list — this is the undo path for a
mistake noticed the next morning. If the task is a recurrence instance, its
`completed` log row is deleted; should that date already be in the past, the
next sweep will record it as a miss.

### 5.2 Archiving

Completed tasks stay in the active list, struck through, until the sweep. Two
distinct timestamps carry this: `completed_at` when you check the box,
`archived_at` when the sweep moves it out.

The sweep archives **whole root trees only**. A tree is eligible when every
task in it is complete and unarchived; then all of its nodes are stamped with
one `archived_at`. A completed subtask under an open parent stays in the active
list indefinitely. This keeps the Archive's group-by-parent view coherent,
because a tree is never split across the active list and the archive.

### 5.3 Repeatable tasks

A `recurrence` spawns one ordinary `task` per scheduled date, with
`recurrence_id` and `occurrence_date` set and `due_date` equal to
`occurrence_date`. An instance is a task like any other: it can be given
subtasks, notes, and a different priority. Those belong to that day's instance
and are not carried to the next occurrence.

Completing an instance writes `completed` to `recurrence_log` and the instance
is archived by the normal tree sweep. An instance left incomplete at the sweep
is recorded as `missed` and deleted from the active list, so the list never
accumulates a backlog and the history stays an honest streak record.

### 5.4 The scheduler

There is no cron. A ticker runs every 60 seconds and asks a single question:
*is there a scheduled run whose local date has no `job_run` row and whose local
time has already passed?* Normal firing, recovery from a missed window,
timezone changes, and DST transitions all collapse into that one code path, and
the `job_run` unique constraint makes a double-fire impossible.

This matters because the container is not guaranteed to be running at 03:00.

**Sweep for local date `D`** — "close out day `D-1`" — one transaction,
idempotent on `job_run('sweep', D)`:

1. Archive every eligible root tree (§5.2).
2. For each active recurrence, for every scheduled date from
   `last_processed_date + 1` through `D - 1` with no `recurrence_log` row:
   insert `missed`, and delete the corresponding uncompleted instance task.
   Advance `last_processed_date` to `D - 1`.
3. For each active recurrence scheduled on `D` with no instance for
   `occurrence_date = D`, create one.
4. Insert the `job_run` row.

**Catch-up.** On boot, and on every tick, the scheduler collects all unswept
dates from the last `job_run` up to today and sweeps them in order. A week of
downtime produces a week of honest `missed` rows, but only *today's* instances
are spawned in step 3 — you do not return to seven stale copies of the same
habit. On a first-ever boot with no `job_run` history, today is recorded as
swept without back-filling anything.

### 5.5 Daily reminder

Optional, keyed on `job_run('reminder', D)`, default 08:00 local. It builds one
neutral payload:

```ts
type ReminderPayload = {
  date: string;                   // local date
  timezone: string;
  overdue: TaskLine[];            // due_date < D, not complete
  dueToday: TaskLine[];           // due_date == D
  repeatsToday: TaskLine[];       // instances with occurrence_date == D
  completedYesterday: TaskLine[]; // archived by the most recent sweep
  missedYesterday: string[];      // recurrence titles logged missed for D-1
};
```

Each list is rendered grouped under Must / Should / Could with category names.
`completedYesterday` is drawn from the tasks the most recent sweep archived,
which is what makes the reminder a summary of yesterday as well as a plan for
today.

A `Notifier` interface has `DiscordNotifier` and `SlackNotifier`
implementations. Both take the same payload and render their own markup —
Discord embeds, Slack blocks — so adding a third destination later touches one
file. Sends retry with exponential backoff three times, then log and give up. A
webhook outage must never break the scheduler or the app.

`POST /api/settings/webhook/test` sends a sample payload so a URL can be
verified without waiting for morning.

### 5.6 Timezone handling

Timestamps are stored in UTC and rendered in `settings.timezone`. Date-only
fields are evaluated in that timezone. Changing the timezone therefore
reinterprets upcoming dates and future scheduling but never rewrites history.
Scheduled jobs already recorded in `job_run` are not re-run for dates they
covered under the old timezone.

Every job and every domain function that needs the current time takes an
injected `Clock` and timezone rather than reading `Date.now()`. This is what
makes "three days of downtime, two of them scheduled" a millisecond-long unit
test.

## 6. API

Base path `/api`. Every route requires `Authorization: Bearer <token>` except
`/api/health` and `/api/auth/login`.

**Auth**

- `POST /auth/login` — `{username, password}` → `{token, expiresAt}`. HS256 JWT
  carrying `token_version`, 90-day expiry. Rate-limited.
- `GET /auth/me` → `{username, timezone}`
- `POST /auth/password` — `{currentPassword, newPassword}`; bumps
  `token_version` and invalidates all existing tokens.

**Tasks**

- `GET /tasks` — the active tree; filters `categoryId`, `priority`, and `q`
  (case-insensitive `LIKE` over title and notes). A filter matching a
  descendant returns its ancestors too, so matches stay in tree context.
- `POST /tasks` — `{title, parentId?, categoryId?, priority?, dueDate?, notes?}`.
  A new subtask defaults to its parent's category.
- `PATCH /tasks/:id` — title, notes, priority, dueDate, categoryId
- `DELETE /tasks/:id` — cascades to the subtree
- `POST /tasks/:id/complete`
- `POST /tasks/:id/uncomplete`
- `POST /tasks/:id/move` — `{parentId, position}`; 409 on cycle

**Archive**

- `GET /archive?groupBy=parent|added|completed&categoryId&from&to&cursor`

  `parent` (default) returns nested archived trees ordered by the most recent
  completion within each tree, descending. `added` and `completed` return a
  flat list grouped by local created-date or completed-date respectively;
  groups are ordered by their most recent completion descending, and rows
  within a group by `completed_at` descending. Every row carries both its added
  and completed dates.

**Notes**

- `GET /notes?q&categoryId&status=active|archived|all&cursor` — flat, newest
  note first. Editing reuses `PATCH /tasks/:id`.

**Categories** — `GET`, `POST`, `PATCH /:id`, `DELETE /:id`

**Recurrences**

- `GET /recurrences`, `POST /recurrences`, `PATCH /recurrences/:id`,
  `DELETE /recurrences/:id`
- `GET /recurrences/:id/history?from&to` — per-date status plus current and
  longest streak

  `PATCH {active:false}` stops a habit while preserving its history. `DELETE`
  removes the definition and its log outright, behind a confirmation in the UI.
  Instance tasks already spawned from it survive as ordinary tasks with
  `recurrence_id` nulled, so archived evidence of work actually done is never
  destroyed by deleting the habit.

**Settings**

- `GET /settings`, `PUT /settings`, `POST /settings/webhook/test`

**Ops**

- `GET /health` — unauthenticated
- `POST /jobs/sweep/run`, `POST /jobs/reminder/run` — authenticated manual
  triggers, for smoke-testing a deployment and for re-running after a timezone
  change

## 7. Web client

React + Vite + TanStack Query, five screens behind a login route.

1. **Active** — the task tree with inline add, drag or keyboard reordering,
   category and priority filters, an optional group-by-category mode. Completed
   tasks remain visible and struck through until the sweep.
2. **Archive** — grouping selector (parent / added date / completed date),
   category filter, date range. Each row shows added and completed dates.
3. **Repeatables** — definitions with a schedule editor and a hit/miss history
   strip per habit.
4. **Notes** — every task with a non-empty note, active and archived, newest
   note first, editable inline, with search and category filter. Each row shows
   the note, task title, category chip, status, and dates.
5. **Settings** — timezone, sweep time, reminder toggle and time, webhook kind
   and URL with a Test button, category management, password change.

The bearer token is held in `localStorage`; a 401 from any request clears it
and redirects to login.

## 8. Error handling

One Fastify error handler emits `{error: {code, message, details?}}`.

| Code | Status | Cause |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Zod failure; `details` carries field paths |
| `UNAUTHENTICATED` | 401 | Missing, malformed, expired, or stale-version token |
| `NOT_FOUND` | 404 | Unknown id |
| `CONFLICT` | 409 | Move would create a cycle; duplicate category name |
| `INTERNAL` | 500 | Anything else; logged with a request id, leaks nothing |

Login is rate-limited via `@fastify/rate-limit`, since the container may end up
reachable from outside the LAN.

## 9. Testing

Test-driven throughout, Vitest.

**Domain units**, with an injected clock:

- completion cascade down, uncomplete cascade up, unarchive-on-uncomplete
- cycle rejection on move; `root_id` rewriting for a moved subtree
- sweep over a fully complete tree, a partially complete tree, and a tree with a
  completed subtask under an open parent
- weekly day-set arithmetic across week boundaries
- multi-day downtime catch-up: misses logged for every skipped scheduled date,
  exactly one instance spawned for today
- a recurrence created mid-gap is not back-filled with misses
- archive grouping and ordering for all three modes
- timezone changes affecting future scheduling but not recorded history

**API integration**, via `app.inject()` against a fresh temporary SQLite file
per test with migrations really applied — so every run exercises the migration
path as well.

**Notifiers**, against a stub HTTP server: Discord and Slack payload shapes, and
retry-then-give-up behaviour against a failing stub.

**Web**, Testing Library over the tree and archive-grouping logic. Full UI
coverage is not a goal.

## 10. Settled decisions

| Decision | Choice | Why |
|---|---|---|
| Deployment | Docker on a home NAS | Always-on, volume-mounted SQLite, env config |
| Auth | Bearer token from `/auth/login` | Identical for web, desktop, and mobile clients |
| Completed vs archived | Two timestamps, swept at `settings.sweep_time` (default 03:00) | Preserves a sense of daily progress; undo stays easy |
| Sweep unit | Whole root trees only | Trees are never split across active and archive |
| Missed repeats | Logged `missed`, cleared from the list | Honest streak history, no backlog |
| Priorities | `must` / `should` / `could` | User's choice |
| Categories | Managed table with colour | Rename in one place, no typo-duplicates |
| Notes page | All notes, active and archived, newest first | Archived tasks hold the notes worth keeping |
| Stack | Fastify + Drizzle + better-sqlite3 + React/Vite | Strong TS typing, shared Zod contract |
| Scheduling | 60s ticker + `job_run` ledger, no cron | One code path for firing, recovery, and DST |

## 11. Future work

Not in scope now, but the design leaves room:

- Native desktop and mobile clients against the same API and shared contract
- Push notifications beyond the webhook reminder
- Category as a fourth Archive grouping, if filtering proves insufficient
- FTS over notes, if `LIKE` becomes slow
- Multi-user, which would require reworking auth and adding ownership columns
