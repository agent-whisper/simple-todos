import type { ReminderPayloadValue, TaskLineValue } from '@simple-todos/shared';
import { sql } from 'drizzle-orm';
import { type AppDb } from '../db/index.js';
import { addLocalDays, startOfLocalDayUtc } from '../time.js';
import type { SettingsService } from './settingsService.js';

const TASK_LINE = sql`
  t.id, t.title, t.priority, c.name AS categoryName, t.due_date AS dueDate
`;

export class ReminderService {
  readonly #db: AppDb;
  readonly #settings: SettingsService;

  constructor(db: AppDb, settings: SettingsService) {
    this.#db = db;
    this.#settings = settings;
  }

  /**
   * The morning message for `targetDate`: what is outstanding today, plus what
   * closed yesterday.
   *
   * "Yesterday" is a local calendar day, so completion times are compared
   * against that day's UTC bounds rather than a raw 24-hour window. The spec
   * describes this section as "what the last sweep archived"; selecting on the
   * completion date instead gives the same answer in normal operation and is
   * still correct when the sweep has not run — a first boot, or a manual
   * trigger.
   */
  buildPayload(targetDate: string): ReminderPayloadValue {
    const { timezone } = this.#settings.get();
    const yesterday = addLocalDays(targetDate, -1);
    const yesterdayStart = startOfLocalDayUtc(yesterday, timezone);
    const todayStart = startOfLocalDayUtc(targetDate, timezone);

    const overdue = this.#db.all<TaskLineValue>(sql`
      SELECT ${TASK_LINE} FROM task t
        LEFT JOIN category c ON c.id = t.category_id
       WHERE t.archived_at IS NULL AND t.completed_at IS NULL
         AND t.due_date IS NOT NULL AND t.due_date < ${targetDate}
       ORDER BY t.due_date
    `);

    // Excludes instances so a repeat appears once, under repeatsToday — its
    // due_date equals its occurrence_date, so it would otherwise be in both.
    const dueToday = this.#db.all<TaskLineValue>(sql`
      SELECT ${TASK_LINE} FROM task t
        LEFT JOIN category c ON c.id = t.category_id
       WHERE t.archived_at IS NULL AND t.completed_at IS NULL
         AND t.due_date = ${targetDate} AND t.recurrence_id IS NULL
       ORDER BY t.position
    `);

    const repeatsToday = this.#db.all<TaskLineValue>(sql`
      SELECT ${TASK_LINE} FROM task t
        LEFT JOIN category c ON c.id = t.category_id
       WHERE t.archived_at IS NULL AND t.completed_at IS NULL
         AND t.occurrence_date = ${targetDate} AND t.recurrence_id IS NOT NULL
       ORDER BY t.position
    `);

    const completedYesterday = this.#db.all<TaskLineValue>(sql`
      SELECT ${TASK_LINE} FROM task t
        LEFT JOIN category c ON c.id = t.category_id
       WHERE t.completed_at >= ${yesterdayStart} AND t.completed_at < ${todayStart}
       ORDER BY t.completed_at DESC
    `);

    const missedRows = this.#db.all<{ title: string }>(sql`
      SELECT r.title FROM recurrence_log l
        JOIN recurrence r ON r.id = l.recurrence_id
       WHERE l.occurrence_date = ${yesterday} AND l.status = 'missed'
       ORDER BY r.title
    `);

    return {
      date: targetDate,
      timezone,
      overdue: normalise(overdue),
      dueToday: normalise(dueToday),
      repeatsToday: normalise(repeatsToday),
      completedYesterday: normalise(completedYesterday),
      missedYesterday: missedRows.map((r) => r.title),
    };
  }
}

/** SQL yields `undefined` for a missing LEFT JOIN column; the contract says null. */
function normalise(rows: TaskLineValue[]): TaskLineValue[] {
  return rows.map((r) => ({
    ...r,
    categoryName: r.categoryName ?? null,
    dueDate: r.dueDate ?? null,
  }));
}
