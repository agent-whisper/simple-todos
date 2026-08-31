import type {
  CreateRecurrenceRequestValue,
  HistoryEntryValue,
  HistoryQueryValue,
  RecurrenceHistoryValue,
  RecurrenceValue,
  UpdateRecurrenceRequestValue,
} from '@simple-todos/shared';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../clock.js';
import { schema, type AppDb } from '../db/index.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import { parseDaysOfWeek, serialiseDaysOfWeek } from '../domain/schedule.js';
import { computeStreaks } from '../domain/streaks.js';
import { addLocalDays, localDate } from '../time.js';
import type { SettingsService } from './settingsService.js';

type Row = typeof schema.recurrences.$inferSelect;

export class RecurrenceService {
  readonly #db: AppDb;
  readonly #clock: Clock;
  readonly #settings: SettingsService;

  constructor(db: AppDb, clock: Clock, settings: SettingsService) {
    this.#db = db;
    this.#clock = clock;
    this.#settings = settings;
  }

  list(): RecurrenceValue[] {
    return this.#db
      .select()
      .from(schema.recurrences)
      .orderBy(desc(schema.recurrences.createdAt))
      .all()
      .map(toValue);
  }

  /** The sweep only ever spawns or closes out habits that are switched on. */
  listActive(): RecurrenceValue[] {
    return this.list().filter((r) => r.active);
  }

  get(id: string): RecurrenceValue {
    const row = this.#db.select().from(schema.recurrences).where(eq(schema.recurrences.id, id)).get();
    if (!row) throw new NotFoundError('recurrence', id);
    return toValue(row);
  }

  create(input: CreateRecurrenceRequestValue): RecurrenceValue {
    const daysOfWeek = input.daysOfWeek ?? null;
    assertScheduleShape(input.scheduleKind, daysOfWeek);
    if (input.categoryId) this.#requireCategory(input.categoryId);

    const now = this.#clock.now();
    const timestamp = now.toISOString();
    const today = localDate(now, this.#settings.get().timezone);
    const id = randomUUID();

    this.#db
      .insert(schema.recurrences)
      .values({
        id,
        title: input.title,
        notes: input.notes ?? null,
        priority: input.priority ?? 'should',
        categoryId: input.categoryId ?? null,
        scheduleKind: input.scheduleKind,
        daysOfWeek: serialiseDaysOfWeek(daysOfWeek),
        active: 1,
        // Yesterday, not today. The watermark means "the last date whose
        // outcome is resolved", and today's is not — its instance is about to
        // be spawned and gets closed out tomorrow. Setting it to today would
        // make the sweep skip the creation day, since it resolves dates
        // strictly after the mark. Nothing before yesterday is ever
        // back-filled, so a new habit still starts with a clean history.
        lastProcessedDate: addLocalDays(today, -1),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    return this.get(id);
  }

  update(id: string, patch: UpdateRecurrenceRequestValue): RecurrenceValue {
    const current = this.get(id);

    const scheduleKind = patch.scheduleKind ?? current.scheduleKind;
    // Switching to daily clears the days even if the patch does not mention them.
    const daysOfWeek =
      scheduleKind === 'daily'
        ? null
        : patch.daysOfWeek !== undefined
          ? patch.daysOfWeek
          : current.daysOfWeek;
    assertScheduleShape(scheduleKind, daysOfWeek);

    if (patch.categoryId) this.#requireCategory(patch.categoryId);

    this.#db
      .update(schema.recurrences)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
        ...(patch.active !== undefined ? { active: patch.active ? 1 : 0 } : {}),
        scheduleKind,
        daysOfWeek: serialiseDaysOfWeek(daysOfWeek),
        updatedAt: this.#clock.now().toISOString(),
      })
      .where(eq(schema.recurrences.id, id))
      .run();

    return this.get(id);
  }

  /**
   * Deletes the definition and, by foreign key, its history. Instance tasks
   * survive with `recurrence_id` nulled — archived evidence of work actually
   * done must not vanish because the habit was deleted.
   */
  remove(id: string): void {
    this.get(id);
    this.#db.delete(schema.recurrences).where(eq(schema.recurrences.id, id)).run();
  }

  /** Advance the watermark once the sweep has resolved every date up to `date`. */
  setLastProcessedDate(id: string, date: string): void {
    this.#db
      .update(schema.recurrences)
      .set({ lastProcessedDate: date })
      .where(eq(schema.recurrences.id, id))
      .run();
  }

  history(id: string, query: HistoryQueryValue): RecurrenceHistoryValue {
    this.get(id); // 404 before querying the log

    const conditions = [eq(schema.recurrenceLogs.recurrenceId, id)];
    // Local-date strings are zero-padded, so a plain comparison is chronological.
    if (query.from) conditions.push(gte(schema.recurrenceLogs.occurrenceDate, query.from));
    if (query.to) conditions.push(lte(schema.recurrenceLogs.occurrenceDate, query.to));

    const rows = this.#db
      .select()
      .from(schema.recurrenceLogs)
      .where(and(...conditions))
      .orderBy(asc(schema.recurrenceLogs.occurrenceDate))
      .all();

    const entries: HistoryEntryValue[] = rows.map((row) => ({
      date: row.occurrenceDate,
      status: row.status as HistoryEntryValue['status'],
      completedAt: row.completedAt ?? null,
    }));

    const { current, longest } = computeStreaks(entries);
    return { recurrenceId: id, entries, currentStreak: current, longestStreak: longest };
  }

  #requireCategory(id: string): void {
    const row = this.#db.select().from(schema.categories).where(eq(schema.categories.id, id)).get();
    if (!row) throw new NotFoundError('category', id);
  }
}

function assertScheduleShape(kind: 'daily' | 'weekly', days: number[] | null): void {
  if (kind === 'weekly' && (days === null || days.length === 0)) {
    throw new ValidationError('a weekly schedule needs at least one day of the week');
  }
  if (kind === 'daily' && days !== null && days.length > 0) {
    throw new ValidationError('a daily schedule cannot list days of the week');
  }
}

function toValue(row: Row): RecurrenceValue {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? null,
    priority: row.priority as RecurrenceValue['priority'],
    categoryId: row.categoryId ?? null,
    scheduleKind: row.scheduleKind as RecurrenceValue['scheduleKind'],
    daysOfWeek: parseDaysOfWeek(row.daysOfWeek),
    active: row.active === 1,
    lastProcessedDate: row.lastProcessedDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
