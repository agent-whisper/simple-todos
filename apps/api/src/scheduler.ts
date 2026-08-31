import type { WebhookKindValue } from '@simple-todos/shared';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Clock } from './clock.js';
import { type AppDb } from './db/index.js';
import type { Notifier } from './notify/notifier.js';
import type { ReminderService } from './services/reminderService.js';
import type { SettingsService } from './services/settingsService.js';
import type { SweepService } from './services/sweepService.js';
import { addLocalDays, compareLocalDate, localDate, localTime } from './time.js';

export interface SchedulerDeps {
  db: AppDb;
  clock: Clock;
  settings: SettingsService;
  sweep: SweepService;
  reminder: ReminderService;
  makeNotifierFor: (kind: WebhookKindValue, url: string) => Notifier;
  log: (message: string, extra?: unknown) => void;
}

const TICK_MS = 60_000;
/** A guard against pathological clock skew, not a real operating limit. */
const MAX_CATCH_UP_DAYS = 400;

/**
 * There is no cron here on purpose.
 *
 * The timezone is a runtime setting, so cron expressions would need tearing
 * down and rebuilding whenever it changed, and cron has no answer for "the
 * container was off at 03:00". A ticker plus the `job_run` ledger collapses
 * normal firing, missed-window recovery, timezone changes and DST into one
 * code path, and the ledger's unique index makes a double-fire impossible.
 */
export class Scheduler {
  readonly #deps: SchedulerDeps;
  readonly #intervalMs: number;
  #timer: NodeJS.Timeout | null = null;
  #running = false;

  constructor(deps: SchedulerDeps, intervalMs = TICK_MS) {
    this.#deps = deps;
    this.#intervalMs = intervalMs;
  }

  start(): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => {
      void this.#safeTick();
    }, this.#intervalMs);
    // Do not hold the process open for the sake of the ticker.
    this.#timer.unref?.();
    void this.#safeTick();
  }

  stop(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  async #safeTick(): Promise<void> {
    // Overlapping ticks would double-run a slow sweep; the ledger would catch
    // it, but skipping is cheaper than rolling back.
    if (this.#running) return;
    this.#running = true;
    try {
      await this.tick();
    } catch (err) {
      this.#deps.log('scheduler tick failed', err);
    } finally {
      this.#running = false;
    }
  }

  async tick(): Promise<void> {
    const { clock, settings, sweep, reminder } = this.#deps;
    const config = settings.get();
    const now = clock.now();
    const today = localDate(now, config.timezone);
    const nowTime = localTime(now, config.timezone);

    this.#runSweeps(today, nowTime, config.sweepTime);

    // Cheap and idempotent: this is what makes a habit created at 10am, after
    // that day's sweep, show up the same day rather than tomorrow.
    sweep.spawnDueInstances(today);

    if (!config.reminderEnabled) return;
    if (nowTime < config.reminderTime) return;
    if (this.#alreadyRan('reminder', today)) return;

    await this.#sendReminder(today, config.webhookKind, config.webhookUrl, reminder);
  }

  #runSweeps(today: string, nowTime: string, sweepTime: string): void {
    const { sweep } = this.#deps;
    const last = sweep.lastSweptDate();

    if (last !== null) {
      // Every date strictly between the last sweep and today has had its whole
      // window pass, so it runs regardless of the clock.
      let date = addLocalDays(last, 1);
      let guard = 0;
      while (compareLocalDate(date, today) < 0 && guard < MAX_CATCH_UP_DAYS) {
        sweep.sweep(date);
        date = addLocalDays(date, 1);
        guard += 1;
      }
      if (guard >= MAX_CATCH_UP_DAYS) {
        this.#deps.log('sweep catch-up hit its day limit; check the clock and settings.timezone');
      }
    }

    // Today runs only once its configured time has arrived. Both sides are
    // zero-padded 'HH:MM', so a string comparison is a chronological one.
    if (nowTime >= sweepTime) sweep.sweep(today);
  }

  async #sendReminder(
    today: string,
    kind: WebhookKindValue | null,
    url: string | null,
    reminder: ReminderService,
  ): Promise<void> {
    // Settings validation guarantees both are present when enabled; belt and
    // braces so a hand-edited database cannot crash the ticker.
    if (kind === null || url === null) return;

    const payload = reminder.buildPayload(today);
    const delivered = await this.#deps.makeNotifierFor(kind, url).send(payload);
    if (!delivered) this.#deps.log('reminder delivery failed after retries');

    // Recorded either way: a webhook outage must not mean a retry every minute
    // for the rest of the day.
    this.#record('reminder', today);
  }

  #alreadyRan(job: 'sweep' | 'reminder', date: string): boolean {
    const row = this.#deps.db.get<{ one: number }>(sql`
      SELECT 1 AS one FROM job_run WHERE job_name = ${job} AND run_date = ${date} LIMIT 1
    `);
    return row !== undefined;
  }

  #record(job: 'sweep' | 'reminder', date: string): void {
    this.#deps.db.run(sql`
      INSERT INTO job_run (id, job_name, run_date, ran_at)
      VALUES (${randomUUID()}, ${job}, ${date}, ${this.#deps.clock.now().toISOString()})
      ON CONFLICT DO NOTHING
    `);
  }
}
