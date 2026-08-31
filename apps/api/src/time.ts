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

/** How far ahead of UTC `timeZone` is at instant `at`, in milliseconds. */
function offsetMsAt(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asIfUtc - at.getTime();
}

/**
 * The UTC instant at which `date` begins in `timeZone`.
 *
 * Used to turn a local-date range into a range of stored timestamps, so the
 * database can do the filtering. Two passes: the first offset is looked up at
 * the naive instant, the second at the corrected one, which settles the case
 * where a DST transition sits between them.
 */
export function startOfLocalDayUtc(date: string, timeZone: string): string {
  const naive = Date.parse(`${date}T00:00:00Z`);
  const firstPass = naive - offsetMsAt(new Date(naive), timeZone);
  const settled = naive - offsetMsAt(new Date(firstPass), timeZone);
  return new Date(settled).toISOString();
}
