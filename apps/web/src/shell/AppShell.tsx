import { NavLink, Outlet } from 'react-router-dom';
import { useSettings } from '../api/hooks';
import { clearToken } from '../auth/session';
import { SweepCountdown } from './SweepCountdown';
import './shell.css';

const DESTINATIONS = [
  { to: '/', label: 'Active', end: true },
  // Second, next to Active: it is a slice of the same list, and the one you
  // come back to most.
  { to: '/working-on', label: 'Working on', end: false },
  { to: '/archive', label: 'Archive', end: false },
  { to: '/repeating', label: 'Repeating', end: false },
  { to: '/notes', label: 'Notes', end: false },
  { to: '/settings', label: 'Settings', end: false },
];

/** Today's date split into the parts the spine sets separately. */
function todayParts(timeZone: string): { day: string; month: string; weekday: string } {
  const now = new Date();
  const fmt = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone, ...options }).format(now);
  return {
    day: fmt({ day: 'numeric' }),
    month: fmt({ month: 'short' }).toUpperCase(),
    weekday: fmt({ weekday: 'short' }).toUpperCase(),
  };
}

/**
 * The day spine. This app's unit of work is the day — finished tasks stay
 * visible until the sweep files them, habits build streaks day by day, the
 * archive groups by day — so the date and the countdown to the next sweep sit
 * on every screen rather than being buried in settings.
 */
export function AppShell({ onSignedOut }: { onSignedOut: () => void }) {
  const settings = useSettings();
  const timeZone = settings.data?.timezone ?? 'UTC';
  const { day, month, weekday } = todayParts(timeZone);

  return (
    <div className="shell">
      <header className="spine">
        <div className="spine__date" data-testid="spine-date">
          <span className="spine__day">{day}</span>
          <span className="spine__month">
            {month} · {weekday}
          </span>
        </div>

        <nav className="spine__nav" aria-label="Sections">
          {DESTINATIONS.map((d) => (
            <NavLink key={d.to} to={d.to} end={d.end}>
              {d.label}
            </NavLink>
          ))}
        </nav>

        <div className="spine__foot">
          {settings.data && (
            <SweepCountdown sweepTime={settings.data.sweepTime} timeZone={settings.data.timezone} />
          )}
          <button
            type="button"
            className="spine__signout"
            onClick={() => {
              clearToken();
              onSignedOut();
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
