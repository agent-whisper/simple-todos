# Why `better-sqlite3` is pinned to `^11.10.0`

`apps/api/package.json` pins `better-sqlite3` well below the current major. The
reason is a **Windows-only** problem on the development machine, not a defect in
the library.

## What happens

On this Windows host, `better-sqlite3@13.x` (and `12.x`) segfaults `node.exe` the
moment a database is opened — no exception, no stack, no Windows error report.
The process simply dies. It was bisected in a scratch project outside this repo:
`13.0.3` and `12.11.1` crash, `11.10.0` does not.

The suspected cause is the endpoint protection installed on that machine
inspecting the freshly built native binding, but that was never proven.

## What is now known

Resolved on 2026-09-01 by running the **latest** `better-sqlite3` inside
`node:22-slim`, opening a real file, enabling WAL, writing and reading a row:

```
rows: {"c":1}
sqlite: 3.53.4
better-sqlite3: 13.0.3
OK — no segfault
```

So the crash is specific to that Windows host. **Linux — and therefore the
Docker image this project actually deploys as — is unaffected.**

## Why the pin stays

The development machine still needs it, and a version that differs between
development and production would be worse than an old one that is the same in
both. `11.10.0` is a supported release and the code uses only the stable API
surface (`new Database`, `.pragma`, `.prepare`, `.close`).

## The knock-on effect in Docker

The pin creates a version conflict with `drizzle-kit`, which pulls
`better-sqlite3` v13 transitively. npm resolves that by hoisting v13 to the
repo root and nesting the pinned v11 under `apps/api/node_modules`. Two
consequences:

- **In development, the pin is only half effective.** Code in `apps/api`
  imports the nested v11, but `drizzle-orm` is hoisted to the root and resolves
  the root's v13. Both copies load. This has never crashed in practice, which
  suggests the Windows fault needs v13 to be the copy that actually opens the
  database.
- **In the image it is fatal without help.** With `--omit=dev` there is no
  drizzle-kit, so nothing puts a copy at the root, while `drizzle-orm` still
  looks only there. The container starts and dies immediately with
  `ERR_MODULE_NOT_FOUND`. `apps/api/Dockerfile` therefore copies the one real
  copy to the root explicitly.

Forcing a single hoisted version with an npm `overrides` entry was tried and
rejected: regenerating `package-lock.json` produces a lock that `npm ci`
refuses, over an unrelated `esbuild` inconsistency between `drizzle-kit` and
`tsx`. That failure reproduces with or without the override, so the committed
lockfile stays as it is.

## When to lift it

Lift it when the Windows machine stops crashing — a different host, or endpoint
protection reconfigured. Re-run the probe above first. Do not lift it on the
grounds that "Linux is fine": that was already true, and is not the constraint.
