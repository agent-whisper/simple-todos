# simple-todos

A personal, single-user todo app: a standalone HTTP API plus a web client,
self-hosted as one Docker container.

Design: `docs/superpowers/specs/2026-08-31-simple-todos-design.md`

## Running it locally

```bash
npm install
cp .env.example .env    # then edit AUTH_* and JWT_SECRET
npm run build:shared
npm run dev:api
```

The API listens on `PORT` (default 3000) and creates `$DATA_DIR/todos.db` on
first boot, seeding the single user from `AUTH_USERNAME` and `AUTH_PASSWORD`.
Those variables seed only when no user exists, so a redeploy never resets your
password — change it through `POST /api/auth/password` instead.

## Tests

```bash
npm test
```

Every integration test runs the real migrations against a throwaway SQLite
file, so the migration path is exercised on every run.

## Concepts

- **Completed vs archived.** Ticking a task sets `completed_at` and leaves it
  in the list, struck through. A nightly sweep sets `archived_at` and moves it
  to the Archive. Only whole complete trees are archived, never half a tree.
- **Priorities** are `must`, `should`, and `could`.
- **Timezone.** Timestamps are stored UTC; calendar dates are interpreted in
  `settings.timezone`, which defaults to `Asia/Tokyo`.

## The web client

```bash
npm run dev:api    # the API on 3000
npm run dev:web    # Vite on 5173, proxying /api to it
```

Vite proxies `/api` so development is same-origin too: nothing needs CORS and
token handling matches production exactly. The production image serves the built
SPA and the API from one origin, so a deep link like `/archive` survives a hard
refresh while a miss under `/api` stays a JSON 404.

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
proxy in front that header is attacker-controlled, and trusting it would let
anyone spoof their way past the limiter.

## Scheduled jobs

A ticker runs every 60 seconds and consults a `job_run` ledger, so the overnight
sweep still happens if the container was off at 03:00 — it catches up on the
next start, recording an honest `missed` for every skipped day while spawning
only today's repeat instances. There is no cron: the timezone is a runtime
setting, and cron has no answer for a container that was not running.

Both jobs can also be run by hand:

```bash
curl -X POST localhost:3000/api/jobs/sweep/run    -H "authorization: Bearer $TOKEN"
curl -X POST localhost:3000/api/jobs/reminder/run -H "authorization: Bearer $TOKEN"
curl -X POST localhost:3000/api/settings/webhook/test -H "authorization: Bearer $TOKEN"
```

A manual reminder run deliberately records nothing, so testing it at noon does
not suppress the real one the next morning.
