import type { RecurrenceValue, ScheduleKindValue } from '@simple-todos/shared';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import {
  useCreateRecurrence,
  useDeleteRecurrence,
  useHistory,
  useRecurrences,
  useUpdateRecurrence,
} from '../api/hooks';
import { HistoryStrip } from '../components/HistoryStrip';
import './screens.css';

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

function describeSchedule(recurrence: RecurrenceValue): string {
  if (recurrence.scheduleKind === 'daily') return 'Every day';
  return (recurrence.daysOfWeek ?? [])
    .slice()
    .sort((a, b) => a - b)
    .map((d) => DAYS.find((x) => x.value === d)?.label ?? String(d))
    .join(', ');
}

function HabitCard({ recurrence }: { recurrence: RecurrenceValue }) {
  const history = useHistory(recurrence.id);
  const update = useUpdateRecurrence();
  const remove = useDeleteRecurrence();

  return (
    <li className={`habit${recurrence.active ? '' : ' habit--paused'}`}>
      <div className="habit__head">
        <h2 className="habit__title">{recurrence.title}</h2>
        <span className="habit__schedule data">{describeSchedule(recurrence)}</span>
        {!recurrence.active && <span className="habit__paused">Paused</span>}
      </div>

      {recurrence.notes && <p className="habit__notes">{recurrence.notes}</p>}

      {history.data && (
        <>
          <HistoryStrip entries={history.data.entries} />
          <p className="habit__streaks data">
            <span>current {history.data.currentStreak}</span>
            <span>longest {history.data.longestStreak}</span>
          </p>
        </>
      )}

      <div className="habit__actions">
        <button
          type="button"
          onClick={() => update.mutate({ id: recurrence.id, patch: { active: !recurrence.active } })}
        >
          {recurrence.active ? 'Pause' : 'Resume'}
        </button>
        <button
          type="button"
          onClick={() => {
            const message =
              'Delete this habit? Its history goes with it. Tasks it already created are kept.';
            if (window.confirm(message)) remove.mutate(recurrence.id);
          }}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

export function RepeatablesScreen() {
  const recurrences = useRecurrences();
  const create = useCreateRecurrence();

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ScheduleKindValue>('daily');
  const [days, setDays] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    create.mutate(
      {
        title: title.trim(),
        scheduleKind: kind,
        ...(kind === 'weekly' ? { daysOfWeek: days } : {}),
      },
      {
        onSuccess: () => {
          setTitle('');
          setDays([]);
        },
        // Surface the API's own message: it says exactly what is wrong, and
        // paraphrasing here would drift from what the server actually enforces.
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : 'That could not be saved.'),
      },
    );
  }

  return (
    <section>
      <h1 className="screen__title">Repeating</h1>

      <form className="habit-form" onSubmit={submit}>
        <div className="filters__group filters__group--grow">
          <label htmlFor="habit-title">Habit</label>
          <input
            id="habit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Exercise"
          />
        </div>

        <div className="filters__group">
          <label htmlFor="habit-kind">Repeats</label>
          <select
            id="habit-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as ScheduleKindValue)}
          >
            <option value="daily">Every day</option>
            <option value="weekly">Certain days</option>
          </select>
        </div>

        {kind === 'weekly' && (
          <fieldset className="days">
            <legend>Days</legend>
            {DAYS.map((day) => (
              <label key={day.value} className="days__day">
                <input
                  type="checkbox"
                  checked={days.includes(day.value)}
                  onChange={(e) =>
                    setDays((current) =>
                      e.target.checked
                        ? [...current, day.value]
                        : current.filter((x) => x !== day.value),
                    )
                  }
                />
                {day.label}
              </label>
            ))}
          </fieldset>
        )}

        <button type="submit">Add habit</button>

        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </form>

      {recurrences.data?.length === 0 && (
        <p className="empty">
          No repeating tasks yet. Add one above and it will appear on the Active list on each day it
          is due, building a record of the days you hit it.
        </p>
      )}

      <ul className="habits">
        {(recurrences.data ?? []).map((recurrence) => (
          <HabitCard key={recurrence.id} recurrence={recurrence} />
        ))}
      </ul>
    </section>
  );
}
