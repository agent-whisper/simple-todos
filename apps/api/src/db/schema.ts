import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const PRIORITY_CHECK = sql`priority IN ('must', 'should', 'could')`;

/** Exactly one row. This app has a single user by design. */
export const users = sqliteTable(
  'user',
  {
    id: integer('id').primaryKey(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    tokenVersion: integer('token_version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [check('user_singleton', sql`${t.id} = 1`)],
);

/** Exactly one row. */
export const settings = sqliteTable(
  'settings',
  {
    id: integer('id').primaryKey(),
    timezone: text('timezone').notNull().default('Asia/Tokyo'),
    sweepTime: text('sweep_time').notNull().default('03:00'),
    reminderEnabled: integer('reminder_enabled').notNull().default(0),
    reminderTime: text('reminder_time').notNull().default('08:00'),
    webhookKind: text('webhook_kind'),
    webhookUrl: text('webhook_url'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('settings_singleton', sql`${t.id} = 1`),
    check('settings_webhook_kind', sql`webhook_kind IS NULL OR webhook_kind IN ('discord', 'slack')`),
  ],
);

export const categories = sqliteTable(
  'category',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    position: integer('position').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('category_name_unique').on(sql`lower(${t.name})`)],
);

export const recurrences = sqliteTable(
  'recurrence',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    notes: text('notes'),
    priority: text('priority').notNull().default('should'),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    scheduleKind: text('schedule_kind').notNull(),
    daysOfWeek: text('days_of_week'),
    active: integer('active').notNull().default(1),
    lastProcessedDate: text('last_processed_date').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  () => [
    check('recurrence_priority', PRIORITY_CHECK),
    check('recurrence_schedule_kind', sql`schedule_kind IN ('daily', 'weekly')`),
    check('recurrence_days_of_week', sql`(schedule_kind = 'weekly') = (days_of_week IS NOT NULL)`),
  ],
);

export const tasks = sqliteTable(
  'task',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id').references((): any => tasks.id, { onDelete: 'cascade' }),
    rootId: text('root_id').notNull(),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    notes: text('notes'),
    notesUpdatedAt: text('notes_updated_at'),
    priority: text('priority').notNull().default('should'),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    dueDate: text('due_date'),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
    archivedAt: text('archived_at'),
    recurrenceId: text('recurrence_id').references(() => recurrences.id, { onDelete: 'set null' }),
    occurrenceDate: text('occurrence_date'),
  },
  (t) => [
    check('task_priority', PRIORITY_CHECK),
    // Invariant 2: nothing is archived without being completed.
    check('task_archived_implies_completed', sql`archived_at IS NULL OR completed_at IS NOT NULL`),
    // One-directional on purpose: ON DELETE SET NULL leaves occurrence_date behind.
    check('task_occurrence_date', sql`recurrence_id IS NULL OR occurrence_date IS NOT NULL`),
    index('task_root_idx').on(t.rootId),
    index('task_parent_idx').on(t.parentId),
    index('task_active_idx').on(t.archivedAt).where(sql`archived_at IS NULL`),
    index('task_notes_idx')
      .on(sql`${t.notesUpdatedAt} DESC`)
      .where(sql`notes IS NOT NULL AND notes <> ''`),
    uniqueIndex('task_occurrence_unique')
      .on(t.recurrenceId, t.occurrenceDate)
      .where(sql`recurrence_id IS NOT NULL`),
  ],
);

export const recurrenceLogs = sqliteTable(
  'recurrence_log',
  {
    id: text('id').primaryKey(),
    recurrenceId: text('recurrence_id')
      .notNull()
      .references(() => recurrences.id, { onDelete: 'cascade' }),
    occurrenceDate: text('occurrence_date').notNull(),
    status: text('status').notNull(),
    completedAt: text('completed_at'),
  },
  (t) => [
    check('recurrence_log_status', sql`status IN ('completed', 'missed')`),
    uniqueIndex('recurrence_log_unique').on(t.recurrenceId, t.occurrenceDate),
  ],
);

export const jobRuns = sqliteTable(
  'job_run',
  {
    id: text('id').primaryKey(),
    jobName: text('job_name').notNull(),
    runDate: text('run_date').notNull(),
    ranAt: text('ran_at').notNull(),
  },
  (t) => [
    check('job_run_name', sql`job_name IN ('sweep', 'reminder')`),
    uniqueIndex('job_run_unique').on(t.jobName, t.runDate),
  ],
);
