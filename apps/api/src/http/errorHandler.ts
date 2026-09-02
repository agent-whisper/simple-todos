import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../domain/errors.js';

export interface ErrorHandlerOptions {
  /**
   * When true, a miss outside /api serves the SPA shell so client-side routes
   * such as /archive work on a hard refresh. Requires @fastify/static to be
   * registered first, since it provides reply.sendFile.
   */
  spaFallback?: boolean;
}

export function registerErrorHandler(app: FastifyInstance, options: ErrorHandlerOptions = {}): void {
  // Fastify allows only one not-found handler per instance, so this is the
  // single place that decides what a miss means.
  app.setNotFoundHandler((req, reply) => {
    // A miss under /api is a genuine 404 and must stay JSON, or a typo in a
    // fetch returns a page of HTML instead of an error the client can read.
    if (options.spaFallback && !req.url.startsWith('/api/')) {
      reply.sendFile('index.html');
      return;
    }
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'route not found' } });
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'request failed validation',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }

    if (err instanceof AppError) {
      reply.status(err.status).send({ error: { code: err.code, message: err.message } });
      return;
    }

    if (err.statusCode === 429) {
      reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'too many requests' } });
      return;
    }

    // Fastify's own body-parser errors (malformed JSON, an oversized body, an
    // unsupported content type) carry a correct 4xx statusCode but are not
    // ZodError/AppError instances. These are client mistakes, not bugs: log
    // them quietly and tell the client only that the request was rejected,
    // never the parser's own message.
    if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      req.log.info({ code: err.code, statusCode: err.statusCode, reqId: req.id }, 'rejected request');
      reply
        .status(err.statusCode)
        .send({ error: { code: 'VALIDATION_ERROR', message: 'request could not be processed' } });
      return;
    }

    // Anything unrecognised is a bug. Log it with the request id; tell the client nothing.
    req.log.error({ err, reqId: req.id }, 'unhandled error');
    reply.status(500).send({ error: { code: 'INTERNAL', message: 'internal server error' } });
  });
}
