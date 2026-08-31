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
