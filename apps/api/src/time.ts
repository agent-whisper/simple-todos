/**
 * Timezone-aware helpers over 'YYYY-MM-DD' local dates.
 *
 * A local date is a calendar day in settings.timezone, not an instant. These
 * functions are pure: an instant only ever enters through `localDate`.
 */

/** en-CA formats as YYYY-MM-DD, which is exactly the shape we store. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The calendar date on which `at` falls, in `timeZone`. */
export function localDate(at: Date, timeZone: string): string {
  return formatterFor(timeZone).format(at);
}

/** Parse 'YYYY-MM-DD' into a UTC-noon Date, safe for day arithmetic. */
function toUtc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

export function addLocalDays(date: string, days: number): string {
  const at = toUtc(date);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** ISO weekday: Monday is 1, Sunday is 7. */
export function localWeekday(date: string): number {
  const dow = toUtc(date).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Local dates are zero-padded, so lexical order is chronological order. */
export function compareLocalDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
