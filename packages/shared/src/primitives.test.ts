import { describe, expect, it } from 'vitest';
import { LocalDate, Priority, PRIORITIES } from './primitives.js';

describe('Priority', () => {
  it('accepts the three levels in order of urgency', () => {
    expect(PRIORITIES).toEqual(['must', 'should', 'could']);
    for (const p of PRIORITIES) expect(Priority.parse(p)).toBe(p);
  });

  it('rejects anything else', () => {
    expect(() => Priority.parse('urgent')).toThrow();
  });
});

describe('LocalDate', () => {
  it('accepts a YYYY-MM-DD string', () => {
    expect(LocalDate.parse('2026-08-31')).toBe('2026-08-31');
  });

  it('rejects a full timestamp', () => {
    expect(() => LocalDate.parse('2026-08-31T00:00:00Z')).toThrow();
  });
});
