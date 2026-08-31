import { UpdateSettingsRequest } from '@simple-todos/shared';
import type { FastifyInstance } from 'fastify';
import type { Clock } from '../../clock.js';
import { ConflictError } from '../../domain/errors.js';
import type { NotifierFactory } from '../../notify/notifier.js';
import type { SettingsService } from '../../services/settingsService.js';
import { localDate } from '../../time.js';

export interface SettingsRouteDeps {
  settings: SettingsService;
  clock: Clock;
  makeNotifierFor: NotifierFactory;
}

/**
 * Registered inside the authenticated scope in `app.ts`, so there is no auth
 * wiring here and nothing a route can forget to attach.
 */
export async function settingsRoutes(app: FastifyInstance, deps: SettingsRouteDeps): Promise<void> {
  const { settings } = deps;

  app.get('/settings', async () => settings.get());

  app.put('/settings', async (req) => settings.update(UpdateSettingsRequest.parse(req.body)));

  app.post('/settings/webhook/test', async () => {
    const config = settings.get();
    if (config.webhookKind === null || config.webhookUrl === null) {
      throw new ConflictError('no webhook is configured');
    }

    // A sample payload, so a URL can be verified without waiting for morning.
    const delivered = await deps.makeNotifierFor(config.webhookKind, config.webhookUrl).send({
      date: localDate(deps.clock.now(), config.timezone),
      timezone: config.timezone,
      overdue: [],
      dueToday: [
        {
          id: '00000000-0000-4000-8000-000000000000',
          title: 'This is a test message from simple-todos',
          priority: 'should',
          categoryName: null,
          dueDate: null,
        },
      ],
      repeatsToday: [],
      completedYesterday: [],
      missedYesterday: [],
    });

    return { delivered };
  });
}
