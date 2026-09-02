import { useEffect, useState } from 'react';

/** Wall-clock 'HH:MM' in a zone, matching how the API compares these. */
function localParts(at: Date, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { hour: get('hour'), minute: get('minute') };
}

/**
 * How long until the next sweep files today's finished work away.
 *
 * Pure minute arithmetic in the user's zone — no date construction — so a DST
 * transition cannot shift the answer by an hour. Exactly at sweep time it
 * reports a full day, because that sweep has just run.
 */
export function timeUntilSweep(
  now: Date,
  sweepTime: string,
  timeZone: string,
): { hours: number; minutes: number } {
  const [sweepHour, sweepMinute] = sweepTime.split(':').map(Number) as [number, number];
  const { hour, minute } = localParts(now, timeZone);

  let delta = sweepHour * 60 + sweepMinute - (hour * 60 + minute);
  if (delta <= 0) delta += 24 * 60;

  return { hours: Math.floor(delta / 60), minutes: delta % 60 };
}

/**
 * The signature detail: the spine says when today's finished work gets filed.
 * It states the app's central mechanic on every screen.
 */
export function SweepCountdown({ sweepTime, timeZone }: { sweepTime: string; timeZone: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const { hours, minutes } = timeUntilSweep(now, sweepTime, timeZone);

  return (
    <p className="spine__sweep">
      <span className="spine__sweep-label">Filing away in</span>
      <span className="spine__sweep-value data">
        {hours}h {String(minutes).padStart(2, '0')}m
      </span>
    </p>
  );
}
