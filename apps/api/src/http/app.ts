import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Clock } from '../clock.js';
import type { Config } from '../config.js';
import type { AppDb } from '../db/index.js';
import { AuthService } from '../services/authService.js';
import { CategoryService } from '../services/categoryService.js';
import { TaskService } from '../services/taskService.js';
import { makeRequireAuth } from './authPlugin.js';
import { registerErrorHandler } from './errorHandler.js';
import { authPrivateRoutes, authPublicRoutes } from './routes/auth.js';
import { categoryRoutes } from './routes/categories.js';
import { healthRoutes } from './routes/health.js';
import { taskRoutes } from './routes/tasks.js';

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
  const tasks = new TaskService(deps.db, deps.clock);
  const categories = new CategoryService(deps.db, deps.clock);

  registerErrorHandler(app);

  // Structurally open: only these two routes exist outside the authenticated scope below.
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authPublicRoutes, { prefix: '/api', auth });

  // Everything registered inside this encapsulated scope is authenticated by construction:
  // the onRequest hook applies to every route plugin registered within it, present or future,
  // with no per-route opt-in required.
  await app.register(
    async (authenticated) => {
      authenticated.addHook('onRequest', requireAuth);
      await authenticated.register(authPrivateRoutes, { auth });
      await authenticated.register(taskRoutes, { tasks });
      await authenticated.register(categoryRoutes, { categories });
    },
    { prefix: '/api' },
  );

  return app;
}
