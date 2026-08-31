import {
  CreateRecurrenceRequest,
  HistoryQuery,
  UpdateRecurrenceRequest,
} from '@simple-todos/shared';
import type { FastifyInstance } from 'fastify';
import type { RecurrenceService } from '../../services/recurrenceService.js';

export interface RecurrenceRouteDeps {
  recurrences: RecurrenceService;
}

/** Registered inside the authenticated scope in `app.ts`. */
export async function recurrenceRoutes(app: FastifyInstance, deps: RecurrenceRouteDeps): Promise<void> {
  const { recurrences } = deps;

  app.get('/recurrences', async () => recurrences.list());

  app.post('/recurrences', async (req, reply) => {
    const created = recurrences.create(CreateRecurrenceRequest.parse(req.body));
    reply.status(201);
    return created;
  });

  app.patch('/recurrences/:id', async (req) =>
    recurrences.update((req.params as { id: string }).id, UpdateRecurrenceRequest.parse(req.body)),
  );

  app.delete('/recurrences/:id', async (req, reply) => {
    recurrences.remove((req.params as { id: string }).id);
    reply.status(204).send();
  });

  app.get('/recurrences/:id/history', async (req) =>
    recurrences.history((req.params as { id: string }).id, HistoryQuery.parse(req.query)),
  );
}
