import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Clock } from '../clock.js';
import type { Config } from '../config.js';
import type { AppDb } from '../db/index.js';
import { registerErrorHandler } from './errorHandler.js';
import { healthRoutes } from './routes/health.js';

export interface AppDeps {
  db: AppDb;
  clock: Clock;
  config: Config;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: deps.config.logLevel } });

  await app.register(rateLimit, { global: false, max: 10, timeWindow: '1 minute' });

  registerErrorHandler(app);
  await app.register(healthRoutes, { prefix: '/api' });

  return app;
}
