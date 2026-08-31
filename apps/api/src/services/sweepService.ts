import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../clock.js';
import { type AppDb } from '../db/index.js';
import { isScheduledOn, scheduledDatesBetween, type Schedule } from '../domain/schedule.js';
import { addLocalDays, compareLocalDate } from '../time.js';
import type { RecurrenceService } from './recurrenceService.js';

export interface SweepResult {
  /** False when this date had already been swept and nothing was done. */
  ran: boolean;
  archived: number;
  missed: number;
  spawned: number;
}

/**
 * The nightly sweep. `sweep(D)` closes out day `D-1` and opens day `D`.
 *
 * Idempotent on `job_run('sweep', D)` and driven entirely by its argument, so
 * catching up after downtime is just calling it once per missed date in order.
 * Nothing here reads ambient time except through the injected clock, which is
 * what makes a week of simulated downtime a millisecond-long test.
 */
export class SweepService {
  readonly #db: AppDb;
  readonly #clock: Clock;
  readonly #recurrences: RecurrenceService;

  constructor(db: AppDb, clock: Clock, recurrences: RecurrenceService) {
    this.#db = db;
    this.#clock = clock;
    this.#recurrences = recurrences;
  }

  lastSweptDate(): string | null {
    const row = this.#db.get<{ runDate: string | null }>(sql`
      SELECT max(run_date) AS runDate FROM job_run WHERE job_name = 'sweep'
    `);
    return row?.runDate ?? null;
  }

  sweep(targetDate: string): SweepResult {
    if (this.#alreadySwept(targetDate)) {
      return { ran: false, archived: 0, missed: 0, spawned: 0 };
    }

    const now = this.#clock.now().toISOString();
    const closingDate = addLocalDays(targetDate, -1);
    let archived = 0;
    let missed = 0;

    this.#db.transaction((tx) => {
      // 1. Archive every root tree that is complete from the root down. A done
      //    subtask under an open parent stays where it is, so the Archive never
      //    holds half a tree.
      const archiveResult = tx.run(sql`
        UPDATE task
           SET archived_at = ${now}
         WHERE root_id IN (
           SELECT root_id FROM task
            GROUP BY root_id
           HAVING sum(completed_at IS NULL) = 0
              AND sum(archived_at IS NOT NULL) = 0
         )
      `);
      archived = Number(archiveResult.changes ?? 0);

      // 2. Close out every scheduled date the habit has not resolved yet.
      for (const recurrence of this.#recurrences.listActive()) {
        const schedule: Schedule = {
          scheduleKind: recurrence.scheduleKind,
          daysOfWeek: recurrence.daysOfWeek,
        };

        for (const date of scheduledDatesBetween(schedule, recurrence.lastProcessedDate, closingDate)) {
          const logged = tx.get<{ one: number }>(sql`
            SELECT 1 AS one FROM recurrence_log
             WHERE recurrence_id = ${recurrence.id} AND occurrence_date = ${date} LIMIT 1
          `);
          if (logged) continue; // already completed, or already recorded missed

          tx.run(sql`
            INSERT INTO recurrence_log (id, recurrence_id, occurrence_date, status, completed_at)
            VALUES (${randomUUID()}, ${recurrence.id}, ${date}, 'missed', NULL)
          `);
          // Drop the stale instance so the list never accumulates a backlog.
          tx.run(sql`
            DELETE FROM task
             WHERE recurrence_id = ${recurrence.id}
               AND occurrence_date = ${date}
               AND completed_at IS NULL
          `);
          missed += 1;
        }

        if (compareLocalDate(closingDate, recurrence.lastProcessedDate) > 0) {
          this.#recurrences.setLastProcessedDate(recurrence.id, closingDate);
        }
      }

      tx.run(sql`
        INSERT INTO job_run (id, job_name, run_date, ran_at)
        VALUES (${randomUUID()}, 'sweep', ${targetDate}, ${now})
      `);
    });

    // 3. Open the target day. Only the target date is spawned, never the
    //    backlog — a week offline must not return a week of stale copies.
    const spawned = this.spawnDueInstances(targetDate);

    return { ran: true, archived, missed, spawned };
  }

  /**
   * Create any missing instance for `date`. Idempotent, and safe to call on
   * every scheduler tick — that is what makes a habit created at 10am appear
   * the same day rather than waiting for tomorrow's sweep.
   */
  spawnDueInstances(date: string): number {
    const now = this.#clock.now().toISOString();
    let spawned = 0;

    this.#db.transaction((tx) => {
      for (const recurrence of this.#recurrences.listActive()) {
        const schedule: Schedule = {
          scheduleKind: recurrence.scheduleKind,
          daysOfWeek: recurrence.daysOfWeek,
        };
        if (!isScheduledOn(schedule, date)) continue;

        const exists = tx.get<{ one: number }>(sql`
          SELECT 1 AS one FROM task
           WHERE recurrence_id = ${recurrence.id} AND occurrence_date = ${date} LIMIT 1
        `);
        if (exists) continue;

        const id = randomUUID();
        // `notes` is deliberately NULL: recurrence.notes describes the habit
        // and is never copied, or the Notes page would collect an identical
        // entry every scheduled day.
        tx.run(sql`
          INSERT INTO task (id, parent_id, root_id, position, title, notes, notes_updated_at,
            priority, category_id, due_date, created_at, completed_at, archived_at,
            recurrence_id, occurrence_date)
          VALUES (${id}, NULL, ${id}, 0, ${recurrence.title}, NULL, NULL,
            ${recurrence.priority}, ${recurrence.categoryId}, ${date}, ${now}, NULL, NULL,
            ${recurrence.id}, ${date})
        `);
        spawned += 1;
      }
    });

    return spawned;
  }

  #alreadySwept(date: string): boolean {
    const row = this.#db.get<{ one: number }>(sql`
      SELECT 1 AS one FROM job_run WHERE job_name = 'sweep' AND run_date = ${date} LIMIT 1
    `);
    return row !== undefined;
  }
}
