import { UpdateSettingsRequest } from '@simple-todos/shared';
import type { FastifyInstance } from 'fastify';
import type { SettingsService } from '../../services/settingsService.js';

export interface SettingsRouteDeps {
  settings: SettingsService;
}

/**
 * Registered inside the authenticated scope in `app.ts`, so there is no auth
 * wiring here and nothing a route can forget to attach.
 */
export async function settingsRoutes(app: FastifyInstance, deps: SettingsRouteDeps): Promise<void> {
  const { settings } = deps;

  app.get('/settings', async () => settings.get());

  app.put('/settings', async (req) => settings.update(UpdateSettingsRequest.parse(req.body)));
}
