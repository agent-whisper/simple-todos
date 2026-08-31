import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export * as schema from './schema.js';

export type AppDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** Migrations are committed SQL files, applied on boot before the server listens. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function openDb(file: string): AppDb {
  const client = new Database(file);
  try {
    // SQLite defaults both of these off; the schema's cascades depend on the first.
    // A corrupt or non-SQLite file surfaces here (reading the header), not at
    // construction time, so the handle must be closed before rethrowing or it
    // leaks for the life of the process.
    client.pragma('foreign_keys = ON');
    client.pragma('journal_mode = WAL');
  } catch (err) {
    client.close();
    throw err;
  }
  return drizzle(client, { schema }) as AppDb;
}

export function runMigrations(db: AppDb): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
