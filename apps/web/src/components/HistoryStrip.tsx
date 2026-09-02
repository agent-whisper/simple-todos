import type { HistoryEntryValue } from '@simple-todos/shared';

/**
 * A row of cells, oldest to newest — one per logged occurrence.
 *
 * A hit is filled, a miss is an outline. The difference is fill, not hue, so it
 * survives any colour vision; each cell also carries a text label naming the
 * date and outcome for assistive tech.
 */
export function HistoryStrip({ entries }: { entries: HistoryEntryValue[] }) {
  if (entries.length === 0) return null;

  return (
    <ol className="strip" aria-label="Recent occurrences">
      {entries.map((entry) => (
        <li
          key={entry.date}
          className={`strip__cell strip__cell--${entry.status === 'completed' ? 'hit' : 'miss'}`}
        >
          <span className="visually-hidden">{`${entry.date}: ${entry.status}`}</span>
        </li>
      ))}
    </ol>
  );
}
