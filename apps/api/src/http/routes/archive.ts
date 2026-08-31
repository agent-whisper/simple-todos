import { ArchiveQuery } from '@simple-todos/shared';
import type { FastifyInstance } from 'fastify';
import type { ArchiveService } from '../../services/archiveService.js';
import type { AuthService } from '../../services/authService.js';

export interface ArchiveRouteDeps {
  archive: ArchiveService;
  auth: AuthService;
}

/** Registered inside the authenticated scope in app.ts; no per-route preHandler needed. */
export async function archiveRoutes(app: FastifyInstance, deps: ArchiveRouteDeps): Promise<void> {
  const { archive, auth } = deps;

  app.get('/archive', async (req) => {
    // Grouping is by local date, so the user's configured zone decides the buckets.
    const { timezone } = auth.me();
    return archive.list(ArchiveQuery.parse(req.query), timezone);
  });
}
