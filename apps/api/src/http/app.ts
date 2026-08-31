import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Clock } from '../clock.js';
import type { Config } from '../config.js';
import type { AppDb } from '../db/index.js';
import { AuthService } from '../services/authService.js';
import { makeRequireAuth } from './authPlugin.js';
import { registerErrorHandler } from './errorHandler.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';

export interface AppDeps {
  db: AppDb;
  clock: Clock;
  config: Config;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: deps.config.logLevel } });

  await app.register(rateLimit, { global: false, max: 10, timeWindow: '1 minute' });

  const auth = new AuthService(deps.db, deps.clock, deps.config);
  await auth.seedIfMissing();
  const requireAuth = makeRequireAuth(auth);

  registerErrorHandler(app);
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api', auth, requireAuth } as never);

  return app;
}
