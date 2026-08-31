import type { FastifyInstance } from 'fastify';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { systemClock } from './clock.js';
import { loadConfig } from './config.js';
import { openDb, runMigrations, type AppDb } from './db/index.js';
import { buildApp } from './http/app.js';

export interface RunningServer {
  app: FastifyInstance;
  stop(): Promise<void>;
}

/**
 * Wire the process together. Migrations run before the app is built, so the
 * container never serves traffic against a schema it has not finished
 * upgrading; a failed migration aborts startup rather than half-working.
 */
export async function startServer(env: NodeJS.ProcessEnv): Promise<RunningServer> {
  const config = loadConfig(env);

  mkdirSync(config.dataDir, { recursive: true });
  const db: AppDb = openDb(join(config.dataDir, 'todos.db'));

  let app: FastifyInstance;
  try {
    runMigrations(db);
    app = await buildApp({ db, clock: systemClock, config });
    await app.ready();
  } catch (err) {
    db.$client.close();
    throw err;
  }

  return {
    app,
    async stop() {
      await app.close();
      db.$client.close();
    },
  };
}

/** Only listen when run as a program, so tests can import this module freely. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startServer(process.env);
  const config = loadConfig(process.env);
  await server.app.listen({ port: config.port, host: '0.0.0.0' });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void server.stop().then(() => process.exit(0));
    });
  }
}
