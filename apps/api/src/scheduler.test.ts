import type { ReminderPayloadValue } from '@simple-todos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Scheduler } from './scheduler.js';
import { makeTestApp, type TestApp } from '../test/helpers/testApp.js';
import { RecurrenceService } from './services/recurrenceService.js';
import { ReminderService } from './services/reminderService.js';
import { SettingsService } from './services/settingsService.js';
import { SweepService } from './services/sweepService.js';

let ctx: TestApp;
let settings: SettingsService;
let recurrences: RecurrenceService;
let sweep: SweepService;
let scheduler: Scheduler;
let sent: ReminderPayloadValue[];
let sendResult: boolean;

beforeEach(async () => {
  // 2026-09-01T00:00Z is 09:00 on the 1st in Tokyo — after the 03:00 sweep
  // time and after the 08:00 reminder time.
  ctx = await makeTestApp('2026-09-01T00:00:00Z');

  settings = new SettingsService(ctx.db, ctx.clock);
  recurrences = new RecurrenceService(ctx.db, ctx.clock, settings);
  sweep = new SweepService(ctx.db, ctx.clock, recurrences);
  const reminder = new ReminderService(ctx.db, settings);

  sent = [];
  sendResult = true;
  scheduler = new Scheduler({
    db: ctx.db,
    clock: ctx.clock,
    settings,
    sweep,
    reminder,
    makeNotifierFor: () => ({
      async send(payload) {
        sent.push(payload);
        return sendResult;
      },
    }),
    log: () => {},
  });
});

afterEach(async () => {
  scheduler.stop();
  await ctx.close();
});

const runDates = (job: 'sweep' | 'reminder') =>
  (
    ctx.db.$client
      .prepare(`SELECT run_date FROM job_run WHERE job_name = ? ORDER BY run_date`)
      .all(job) as { run_date: string }[]
  ).map((r) => r.run_date);

const missedDates = () =>
  (
    ctx.db.$client
      .prepare(`SELECT occurrence_date FROM recurrence_log WHERE status = 'missed' ORDER BY occurrence_date`)
      .all() as { occurrence_date: string }[]
  ).map((r) => r.occurrence_date);

const instanceDates = () =>
  (
    ctx.db.$client
      .prepare(`SELECT occurrence_date FROM task WHERE recurrence_id IS NOT NULL ORDER BY occurrence_date`)
      .all() as { occurrence_date: string }[]
  ).map((r) => r.occurrence_date);

describe('sweep scheduling', () => {
  it('sweeps today once the local sweep time has passed', async () => {
    await scheduler.tick();
    expect(runDates('sweep')).toEqual(['2026-09-01']);
  });

  it('does not sweep before the local sweep time', async () => {
    // 2026-08-31T17:00Z is 02:00 on the 1st in Tokyo — before 03:00.
    ctx.clock.set('2026-08-31T17:00:00Z');
    await scheduler.tick();
    expect(runDates('sweep')).toEqual([]);
  });

  it('does not sweep the same date twice across ticks', async () => {
    await scheduler.tick();
    await scheduler.tick();
    expect(runDates('sweep')).toEqual(['2026-09-01']);
  });

  it('uses the configured sweep time', async () => {
    settings.update({ sweepTime: '10:00' });
    await scheduler.tick(); // local 09:00, before 10:00
    expect(runDates('sweep')).toEqual([]);

    ctx.clock.set('2026-09-01T02:00:00Z'); // local 11:00
    await scheduler.tick();
    expect(runDates('sweep')).toEqual(['2026-09-01']);
  });
});

describe('downtime catch-up', () => {
  it('sweeps every missed date in order after a gap', async () => {
    await scheduler.tick(); // establishes 2026-09-01

    // The container is off for three days.
    ctx.clock.set('2026-09-05T00:00:00Z'); // local 09:00 on the 5th
    await scheduler.tick();

    expect(runDates('sweep')).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
  });

  it('logs a miss for every skipped scheduled day', async () => {
    recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    await scheduler.tick();

    ctx.clock.set('2026-09-05T00:00:00Z');
    await scheduler.tick();

    expect(missedDates()).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
  });

  it('spawns only today after a gap, not one instance per missed day', async () => {
    recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    await scheduler.tick();

    ctx.clock.set('2026-09-05T00:00:00Z');
    await scheduler.tick();

    expect(instanceDates()).toEqual(['2026-09-05']);
  });

  it('does not back-fill a habit created during the gap', async () => {
    await scheduler.tick(); // 2026-09-01 swept

    ctx.clock.set('2026-09-03T00:00:00Z');
    recurrences.create({ title: 'New habit', scheduleKind: 'daily' });

    ctx.clock.set('2026-09-05T00:00:00Z');
    await scheduler.tick();

    // Only the 3rd and 4th — never before the habit existed.
    expect(missedDates()).toEqual(['2026-09-03', '2026-09-04']);
  });

  it('records nothing historical on a first-ever boot', async () => {
    await scheduler.tick();
    expect(runDates('sweep')).toEqual(['2026-09-01']);
  });
});

describe('spawning outside the sweep', () => {
  it('gives a habit created after today sweep its instance on the next tick', async () => {
    await scheduler.tick(); // today already swept

    recurrences.create({ title: 'Exercise', scheduleKind: 'daily' });
    await scheduler.tick();

    expect(instanceDates()).toEqual(['2026-09-01']);
  });
});

describe('reminder scheduling', () => {
  function enableWebhook() {
    settings.update({
      reminderEnabled: true,
      webhookKind: 'discord',
      webhookUrl: 'https://example.test/hook',
    });
  }

  it('sends nothing when the reminder is disabled', async () => {
    await scheduler.tick();
    expect(sent).toHaveLength(0);
    expect(runDates('reminder')).toEqual([]);
  });

  it('sends once the local reminder time has passed', async () => {
    enableWebhook();
    await scheduler.tick();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.date).toBe('2026-09-01');
    expect(runDates('reminder')).toEqual(['2026-09-01']);
  });

  it('does not send before the local reminder time', async () => {
    enableWebhook();
    ctx.clock.set('2026-08-31T22:00:00Z'); // local 07:00
    await scheduler.tick();
    expect(sent).toHaveLength(0);
  });

  it('sends only once a day across many ticks', async () => {
    enableWebhook();
    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();
    expect(sent).toHaveLength(1);
  });

  it('records the run even when delivery fails, so it does not retry every minute', async () => {
    enableWebhook();
    sendResult = false;

    await scheduler.tick();
    await scheduler.tick();

    expect(sent).toHaveLength(1);
    expect(runDates('reminder')).toEqual(['2026-09-01']);
  });

  it('does not back-fill reminders for missed days', async () => {
    enableWebhook();
    await scheduler.tick();

    ctx.clock.set('2026-09-05T00:00:00Z');
    await scheduler.tick();

    // Yesterday's news is not worth sending four days late.
    expect(runDates('reminder')).toEqual(['2026-09-01', '2026-09-05']);
  });
});

describe('lifecycle', () => {
  it('start and stop do not throw, and stop is idempotent', () => {
    scheduler.start();
    scheduler.stop();
    scheduler.stop();
  });

  it('a failing tick is logged rather than thrown', async () => {
    const logged: string[] = [];
    const broken = new Scheduler({
      db: ctx.db,
      clock: ctx.clock,
      settings: {
        get() {
          throw new Error('settings exploded');
        },
      } as unknown as SettingsService,
      sweep,
      reminder: new ReminderService(ctx.db, settings),
      makeNotifierFor: () => ({ async send() { return true; } }),
      log: (m) => logged.push(m),
    });

    // start() ticks immediately; the throw must not escape.
    broken.start();
    await new Promise((r) => setTimeout(r, 20));
    broken.stop();

    expect(logged).toContain('scheduler tick failed');
  });
});
