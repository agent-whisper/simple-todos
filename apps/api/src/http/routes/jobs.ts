import { LocalDate } from '@simple-todos/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '../../clock.js';
import { ConflictError } from '../../domain/errors.js';
import type { NotifierFactory } from '../../notify/notifier.js';
import type { ReminderService } from '../../services/reminderService.js';
import type { SettingsService } from '../../services/settingsService.js';
import type { SweepService } from '../../services/sweepService.js';
import { localDate } from '../../time.js';

const RunSweepRequest = z.object({ date: LocalDate.optional() });

export interface JobRouteDeps {
  clock: Clock;
  settings: SettingsService;
  sweep: SweepService;
  reminder: ReminderService;
  makeNotifierFor: NotifierFactory;
}

/** Registered inside the authenticated scope in `app.ts`. */
export async function jobRoutes(app: FastifyInstance, deps: JobRouteDeps): Promise<void> {
  const { clock, settings, sweep, reminder, makeNotifierFor } = deps;

  app.post('/jobs/sweep/run', async (req) => {
    const { date } = RunSweepRequest.parse(req.body ?? {});
    return sweep.sweep(date ?? localDate(clock.now(), settings.get().timezone));
  });

  app.post('/jobs/reminder/run', async () => {
    const config = settings.get();
    if (config.webhookKind === null || config.webhookUrl === null) {
      throw new ConflictError('no webhook is configured');
    }

    const date = localDate(clock.now(), config.timezone);
    const delivered = await makeNotifierFor(config.webhookKind, config.webhookUrl).send(
      reminder.buildPayload(date),
    );

    // Deliberately writes no job_run row: a manual run is for testing and must
    // not suppress the genuine scheduled reminder later the same day.
    return { delivered, date };
  });
}
