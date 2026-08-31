import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dirs = new Set<string>();

/** A throwaway SQLite path. Each test gets its own file and its own migrations run. */
export function makeTempDbFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'simple-todos-'));
  dirs.add(dir);
  return join(dir, 'todos.db');
}

export function removeTempDb(file: string): void {
  const dir = join(file, '..');
  rmSync(dir, { recursive: true, force: true });
  dirs.delete(dir);
}
