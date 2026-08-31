import type { SettingsValue, UpdateSettingsRequestValue } from '@simple-todos/shared';
import { eq } from 'drizzle-orm';
import type { Clock } from '../clock.js';
import { schema, type AppDb } from '../db/index.js';
import { ValidationError } from '../domain/errors.js';

const SINGLETON_ID = 1;

/**
 * Cheap IANA validation: Intl throws on an unknown zone.
 *
 * Worth doing at the boundary — an unknown zone stored here would make every
 * later date calculation throw deep inside the scheduler instead of failing
 * the request that caused it.
 */
function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  } catch {
    throw new ValidationError(`unknown timezone "${timezone}"`);
  }
}

export class SettingsService {
  readonly #db: AppDb;
  readonly #clock: Clock;

  constructor(db: AppDb, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  get(): SettingsValue {
    const row = this.#db.select().from(schema.settings).where(eq(schema.settings.id, SINGLETON_ID)).get();
    if (!row) throw new Error('settings row missing — seeding did not run');

    return {
      timezone: row.timezone,
      sweepTime: row.sweepTime,
      // SQLite has no boolean type; the column is 0/1 and the contract says boolean.
      reminderEnabled: row.reminderEnabled === 1,
      reminderTime: row.reminderTime,
      webhookKind: (row.webhookKind as SettingsValue['webhookKind']) ?? null,
      webhookUrl: row.webhookUrl ?? null,
      updatedAt: row.updatedAt,
    };
  }

  update(patch: UpdateSettingsRequestValue): SettingsValue {
    const current = this.get();
    const next: SettingsValue = { ...current, ...patch, updatedAt: this.#clock.now().toISOString() };

    if (patch.timezone !== undefined) assertValidTimezone(patch.timezone);

    // Enabling the reminder with nowhere to send it would fail silently every
    // morning, so the combination is rejected rather than stored. Checked
    // against the merged result, so a patch may supply both at once.
    if (next.reminderEnabled && (next.webhookKind === null || next.webhookUrl === null)) {
      throw new ValidationError('a webhook kind and url are required to enable the daily reminder');
    }

    this.#db
      .update(schema.settings)
      .set({
        timezone: next.timezone,
        sweepTime: next.sweepTime,
        reminderEnabled: next.reminderEnabled ? 1 : 0,
        reminderTime: next.reminderTime,
        webhookKind: next.webhookKind,
        webhookUrl: next.webhookUrl,
        updatedAt: next.updatedAt,
      })
      .where(eq(schema.settings.id, SINGLETON_ID))
      .run();

    return this.get();
  }
}
