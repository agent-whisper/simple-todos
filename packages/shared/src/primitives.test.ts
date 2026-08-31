import { describe, expect, it } from 'vitest';
import { IsoDateTime, LocalDate, Priority, PRIORITIES, Uuid } from './primitives.js';

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

  it('accepts a real leap day', () => {
    expect(LocalDate.parse('2028-02-29')).toBe('2028-02-29');
  });

  it('rejects a date that overflows its month', () => {
    expect(() => LocalDate.parse('2026-02-31')).toThrow();
  });

  it('rejects an impossible month', () => {
    expect(() => LocalDate.parse('2026-13-45')).toThrow();
  });

  it('rejects a wildly impossible calendar date', () => {
    expect(() => LocalDate.parse('9999-99-99')).toThrow();
  });

  it('rejects an all-zero date', () => {
    expect(() => LocalDate.parse('0000-00-00')).toThrow();
  });
});

describe('IsoDateTime', () => {
  it('accepts a UTC timestamp', () => {
    expect(IsoDateTime.parse('2026-08-31T00:00:00.000Z')).toBe('2026-08-31T00:00:00.000Z');
  });

  it('rejects a date-only string', () => {
    expect(() => IsoDateTime.parse('2026-08-31')).toThrow();
  });
});

describe('Uuid', () => {
  it('accepts a valid v4 uuid', () => {
    expect(Uuid.parse('11111111-1111-4111-8111-111111111111')).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('rejects a non-uuid string', () => {
    expect(() => Uuid.parse('not-a-uuid')).toThrow();
  });
});
