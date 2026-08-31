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
  // SQLite defaults both of these off; the schema's cascades depend on the first.
  client.pragma('foreign_keys = ON');
  client.pragma('journal_mode = WAL');
  return drizzle(client, { schema }) as AppDb;
}

export function runMigrations(db: AppDb): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
