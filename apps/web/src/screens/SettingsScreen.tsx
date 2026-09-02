import type { CategoryValue, WebhookKindValue } from '@simple-todos/shared';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import {
  useCategories,
  useChangePassword,
  useCreateCategory,
  useDeleteCategory,
  useSettings,
  useTestWebhook,
  useUpdateCategory,
  useUpdateSettings,
} from '../api/hooks';
import { clearToken } from '../auth/session';
import './screens.css';

function CategoryRow({ category }: { category: CategoryValue }) {
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);
  const update = useUpdateCategory();
  const remove = useDeleteCategory();

  return (
    <li className="category">
      <label className="visually-hidden" htmlFor={`cat-name-${category.id}`}>
        Name of {category.name}
      </label>
      <input
        id={`cat-name-${category.id}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name !== category.name && update.mutate({ id: category.id, patch: { name } })}
      />

      <label className="visually-hidden" htmlFor={`cat-color-${category.id}`}>
        Colour of {category.name}
      </label>
      <input
        id={`cat-color-${category.id}`}
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        onBlur={() => color !== category.color && update.mutate({ id: category.id, patch: { color } })}
      />

      <button
        type="button"
        onClick={() => {
          const message = `Delete "${category.name}"? Tasks keep their place; they just lose the label.`;
          if (window.confirm(message)) remove.mutate(category.id);
        }}
      >
        Delete
      </button>
    </li>
  );
}

export function SettingsScreen({ onSignedOut }: { onSignedOut: () => void }) {
  const settings = useSettings();
  const categories = useCategories();
  const updateSettings = useUpdateSettings();
  const createCategory = useCreateCategory();
  const testWebhook = useTestWebhook();
  const changePassword = useChangePassword();

  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState({ name: '', color: '#28407a' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [passwordError, setPasswordError] = useState<string | null>(null);

  if (!settings.data) return <p className="muted">Loading…</p>;
  const current = settings.data;

  function save(patch: Parameters<typeof updateSettings.mutate>[0]) {
    setScheduleError(null);
    updateSettings.mutate(patch, {
      // The API's message names exactly what is missing; repeating it beats
      // inventing a vaguer one here.
      onError: (err) =>
        setScheduleError(err instanceof ApiError ? err.message : 'That could not be saved.'),
    });
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    changePassword.mutate(passwords, {
      onSuccess: () => {
        // The API bumps token_version, retiring every token including this
        // one. Staying put would leave the user on a dead session.
        clearToken();
        onSignedOut();
      },
      onError: (err) =>
        setPasswordError(err instanceof ApiError ? err.message : 'That could not be saved.'),
    });
  }

  return (
    <section>
      <h1 className="screen__title">Settings</h1>

      <fieldset className="panel">
        <legend>Schedule</legend>

        <div className="panel__row">
          <label htmlFor="tz">Time zone</label>
          <input
            id="tz"
            defaultValue={current.timezone}
            onBlur={(e) => e.target.value !== current.timezone && save({ timezone: e.target.value })}
          />
        </div>

        <div className="panel__row">
          <label htmlFor="sweep">Files finished tasks away at</label>
          <input
            id="sweep"
            defaultValue={current.sweepTime}
            onBlur={(e) => e.target.value !== current.sweepTime && save({ sweepTime: e.target.value })}
          />
        </div>

        {scheduleError && (
          <p role="alert" className="error">
            {scheduleError}
          </p>
        )}
      </fieldset>

      <fieldset className="panel">
        <legend>Daily reminder</legend>

        <div className="panel__row">
          <label htmlFor="webhook-kind">Send to</label>
          <select
            id="webhook-kind"
            value={current.webhookKind ?? ''}
            onChange={(e) =>
              save({ webhookKind: (e.target.value || null) as WebhookKindValue | null })
            }
          >
            <option value="">Nowhere</option>
            <option value="discord">Discord</option>
            <option value="slack">Slack</option>
          </select>
        </div>

        <div className="panel__row">
          <label htmlFor="webhook-url">Webhook address</label>
          <input
            id="webhook-url"
            defaultValue={current.webhookUrl ?? ''}
            onBlur={(e) =>
              e.target.value !== (current.webhookUrl ?? '') &&
              save({ webhookUrl: e.target.value || null })
            }
          />
        </div>

        <div className="panel__row">
          <label htmlFor="reminder-time">Send at</label>
          <input
            id="reminder-time"
            defaultValue={current.reminderTime}
            onBlur={(e) =>
              e.target.value !== current.reminderTime && save({ reminderTime: e.target.value })
            }
          />
        </div>

        <div className="panel__row">
          <label htmlFor="reminder-on">Send it</label>
          <input
            id="reminder-on"
            type="checkbox"
            checked={current.reminderEnabled}
            onChange={(e) => save({ reminderEnabled: e.target.checked })}
          />
        </div>

        <div className="panel__row">
          <button type="button" onClick={() => testWebhook.mutate()}>
            Send a test message
          </button>
          {testWebhook.data && (
            <span role="status">
              {testWebhook.data.delivered ? 'Sent.' : 'Could not deliver it.'}
            </span>
          )}
          {testWebhook.isError && <span role="status">No webhook is configured yet.</span>}
        </div>
      </fieldset>

      <fieldset className="panel">
        <legend>Categories</legend>

        <ul className="categories">
          {(categories.data ?? []).map((category) => (
            <CategoryRow key={category.id} category={category} />
          ))}
        </ul>

        <form
          className="panel__row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!newCategory.name.trim()) return;
            createCategory.mutate(newCategory, {
              onSuccess: () => setNewCategory({ name: '', color: '#28407a' }),
            });
          }}
        >
          <label htmlFor="new-category">Add a category</label>
          <input
            id="new-category"
            value={newCategory.name}
            onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
            placeholder="Chores"
          />
          <label className="visually-hidden" htmlFor="new-category-color">
            Colour for the new category
          </label>
          <input
            id="new-category-color"
            type="color"
            value={newCategory.color}
            onChange={(e) => setNewCategory({ ...newCategory, color: e.target.value })}
          />
          <button type="submit">Add</button>
        </form>
      </fieldset>

      <fieldset className="panel">
        <legend>Password</legend>

        <form onSubmit={submitPassword}>
          <div className="panel__row">
            <label htmlFor="current-password">Current password</label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={passwords.currentPassword}
              onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
            />
          </div>

          <div className="panel__row">
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={passwords.newPassword}
              onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
            />
          </div>

          <p className="muted">Changing it signs you out everywhere.</p>

          <button type="submit">Change password</button>

          {passwordError && (
            <p role="alert" className="error">
              {passwordError}
            </p>
          )}
        </form>
      </fieldset>
    </section>
  );
}
