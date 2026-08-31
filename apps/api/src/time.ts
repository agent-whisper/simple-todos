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

/** Every real-world DST transition lands on a 15-minute boundary. */
const NUDGE_MS = 15 * 60 * 1000;
/** Safety cap: no real transition shifts the clock by anywhere near this much. */
const MAX_NUDGES = 24; // 6 hours

/**
 * The UTC instant at which `date` begins in `timeZone`.
 *
 * Used to turn a local-date range into a range of stored timestamps, so the
 * database can do the filtering. Two passes: the first offset is looked up at
 * the naive instant, the second at the corrected one, which settles the case
 * where a DST transition sits between the naive guess and the corrected one
 * (e.g. Australia/Sydney, where a single pass lands on the wrong calendar day).
 *
 * Convention for a zone that skips local midnight entirely (a spring-forward
 * transition that jumps straight over 00:00, e.g. America/Santiago on
 * 2026-09-06, where 23:59:59 the day before is immediately followed by
 * 01:00:00): `date` is defined to begin at the first instant that genuinely
 * falls on that calendar date, i.e. the moment the clocks jump forward to. The
 * two-pass calculation above can land slightly before that moment — inside the
 * *previous* local day — so this verifies the result against `localDate` and
 * nudges forward (or, symmetrically, backward, in case a future timezone rule
 * ever undershoots the other way) in 15-minute steps, which is fine-grained
 * enough for every real-world UTC offset and DST rule.
 */
export function startOfLocalDayUtc(date: string, timeZone: string): string {
  const naive = Date.parse(`${date}T00:00:00Z`);
  // LocalDate's own validation should always catch this first, but this is a
  // shared helper (Plan 2's scheduler pushes many local-date strings through
  // it), so it guards itself too: a NaN here would otherwise reach
  // Intl.DateTimeFormat#formatToParts and surface as an opaque native
  // RangeError with no mention of the offending input.
  if (Number.isNaN(naive)) {
    throw new Error(`invalid local date: ${date}`);
  }
  const firstPass = naive - offsetMsAt(new Date(naive), timeZone);
  let settled = naive - offsetMsAt(new Date(firstPass), timeZone);

  for (let i = 0; i < MAX_NUDGES && localDate(new Date(settled), timeZone) < date; i += 1) {
    settled += NUDGE_MS;
  }
  for (let i = 0; i < MAX_NUDGES && localDate(new Date(settled), timeZone) > date; i += 1) {
    settled -= NUDGE_MS;
  }

  return new Date(settled).toISOString();
}
