import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Clock } from '../clock.js';
import type { Config } from '../config.js';
import type { AppDb } from '../db/index.js';
import { makeNotifier, type FetchLike, type NotifierFactory } from '../notify/notifier.js';
import { ArchiveService } from '../services/archiveService.js';
import { AuthService } from '../services/authService.js';
import { RecurrenceService } from '../services/recurrenceService.js';
import { SettingsService } from '../services/settingsService.js';
import { CategoryService } from '../services/categoryService.js';
import { NoteService } from '../services/noteService.js';
import { ReminderService } from '../services/reminderService.js';
import { SweepService } from '../services/sweepService.js';
import { TaskService } from '../services/taskService.js';
import { makeRequireAuth } from './authPlugin.js';
import { registerErrorHandler } from './errorHandler.js';
import { archiveRoutes } from './routes/archive.js';
import { authPrivateRoutes, authPublicRoutes } from './routes/auth.js';
import { categoryRoutes } from './routes/categories.js';
import { healthRoutes } from './routes/health.js';
import { jobRoutes } from './routes/jobs.js';
import { recurrenceRoutes } from './routes/recurrences.js';
import { settingsRoutes } from './routes/settings.js';
import { noteRoutes } from './routes/notes.js';
import { taskRoutes } from './routes/tasks.js';

export interface AppDeps {
  db: AppDb;
  clock: Clock;
  config: Config;
  /** Injected by tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
  /**
   * Called for every route as it registers. Exists because the auth guard needs
   * a real route table: Fastify's printRoutes discards a wildcard route's
   * prefix, and an onRoute hook added after `register()` boots is too late.
   */
  onRoute?: (route: { method: string; url: string }) => void;
  /** When set, the built SPA is served from this directory. */
  staticRoot?: string;
}

/** The app plus the pieces `startServer` needs to build a Scheduler. */
export interface BuiltApp {
  app: FastifyInstance;
  settings: SettingsService;
  sweep: SweepService;
  reminder: ReminderService;
  makeNotifierFor: NotifierFactory;
}

/** Kept so every existing caller and test helper compiles unchanged. */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  return (await buildAppWithServices(deps)).app;
}

export async function buildAppWithServices(deps: AppDeps): Promise<BuiltApp> {
  const app = Fastify({
    logger: { level: deps.config.logLevel },
    // Behind a reverse proxy every request otherwise carries the proxy's IP, so
    // the login rate limiter buckets all clients together and one attacker can
    // lock the owner out. Opt-in: trusting X-Forwarded-For when NOT behind a
    // proxy would let anyone spoof their way around the limiter.
    trustProxy: deps.config.trustProxy,
  });

  if (deps.onRoute) {
    const observe = deps.onRoute;
    app.addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) observe({ method, url: route.url });
    });
  }

  await app.register(rateLimit, { global: false, max: 10, timeWindow: '1 minute' });

  const auth = new AuthService(deps.db, deps.clock, deps.config);
  await auth.seedIfMissing();
  const requireAuth = makeRequireAuth(auth);

  const settings = new SettingsService(deps.db, deps.clock);
  const recurrences = new RecurrenceService(deps.db, deps.clock, settings);
  const tasks = new TaskService(deps.db, deps.clock);
  const categories = new CategoryService(deps.db, deps.clock);
  const archive = new ArchiveService(deps.db);
  const notes = new NoteService(deps.db);
  const sweep = new SweepService(deps.db, deps.clock, recurrences);
  const reminder = new ReminderService(deps.db, settings);

  const fetchImpl: FetchLike =
    deps.fetchImpl ??
    (async (url, init) => {
      const res = await fetch(url, init);
      return { ok: res.ok, status: res.status };
    });
  const makeNotifierFor: NotifierFactory = (kind, url) => makeNotifier(kind, url, { fetchImpl });

  // Registered before the error handler, which needs reply.sendFile to exist
  // before it can offer the SPA fallback.
  if (deps.staticRoot) {
    // wildcard:false so @fastify/static does not claim every unmatched path —
    // the not-found handler decides what a miss means.
    await app.register(fastifyStatic, { root: deps.staticRoot, wildcard: false });
  }

  registerErrorHandler(app, { spaFallback: deps.staticRoot !== undefined });

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
      await authenticated.register(settingsRoutes, { settings, clock: deps.clock, makeNotifierFor });
      await authenticated.register(recurrenceRoutes, { recurrences });
      await authenticated.register(taskRoutes, { tasks });
      await authenticated.register(categoryRoutes, { categories });
      await authenticated.register(archiveRoutes, { archive, auth });
      await authenticated.register(noteRoutes, { notes });
      await authenticated.register(jobRoutes, {
        clock: deps.clock,
        settings,
        sweep,
        reminder,
        makeNotifierFor,
      });
    },
    { prefix: '/api' },
  );

  return { app, settings, sweep, reminder, makeNotifierFor };
}
