import type { FastifyInstance } from 'fastify';

/** Unauthenticated on purpose: the container healthcheck calls it. */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok' }));
}
