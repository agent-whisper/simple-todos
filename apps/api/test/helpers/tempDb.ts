import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations } from '../../src/db/index.js';

const dirs = new Set<string>();

/**
 * Running the full migration set is the expensive part of setting up a test
 * database. Under vitest's parallel workers, doing it fresh in every single
 * `beforeEach` (13+ test files' worth, all contending for disk at once) was
 * slow enough to occasionally blow past the default 10s hook timeout and fail
 * an unrelated test's setup.
 *
 * Instead, build one migrated template file per worker process (this is where
 * `runMigrations` actually runs, so the real migration path is still exercised
 * on every suite run — it just runs once instead of once per test) and copy
 * that small file for every test. Copying a file is orders of magnitude
 * cheaper than replaying every migration.
 */
let templateFile: string | null = null;

function buildTemplate(): string {
  const dir = mkdtempSync(join(tmpdir(), 'simple-todos-template-'));
  const file = join(dir, 'template.db');
  const db = openDb(file);
  runMigrations(db);
  // Force the WAL contents into the main file and turn WAL off so the
  // template is one self-contained file with no -wal/-shm sidecars that a
  // plain file copy could miss or leave inconsistent. It's a template that is
  // never queried live, so DELETE-mode journalling is fine for it.
  db.$client.pragma('wal_checkpoint(TRUNCATE)');
  db.$client.pragma('journal_mode = DELETE');
  db.$client.close();
  return file;
}

/** A throwaway SQLite path, seeded by copying the migrated template above. */
export function makeTempDbFile(): string {
  templateFile ??= buildTemplate();

  const dir = mkdtempSync(join(tmpdir(), 'simple-todos-'));
  dirs.add(dir);
  const file = join(dir, 'todos.db');
  copyFileSync(templateFile, file);
  return file;
}

export function removeTempDb(file: string): void {
  const dir = join(file, '..');
  rmSync(dir, { recursive: true, force: true });
  dirs.delete(dir);
}
