import type { ZodType } from 'zod';
import { ValidationError } from '../domain/errors.js';

/**
 * Composite keyset cursors, shared by every paginated list endpoint.
 *
 * A cursor built from a bare timestamp silently drops rows when two of them
 * share the exact same instant and the page boundary falls between them —
 * ties are not an edge case here: a cascade completion stamps a whole tree
 * with one identical `completed_at` by design. Encoding a `(sort key, tie
 * breaker)` pair and comparing with SQLite row-value comparison keeps every
 * row addressable no matter how many share a timestamp.
 *
 * Decoding is defensive on purpose: a cursor that does not decode to the
 * expected shape raises a 400 (`ValidationError`) rather than silently
 * producing an arbitrary filter.
 */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor<T>(cursor: string, schema: ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError('malformed cursor');
  }

  const result = schema.safeParse(parsed);
  if (!result.success) throw new ValidationError('malformed cursor');
  return result.data;
}
