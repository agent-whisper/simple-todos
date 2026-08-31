import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../domain/errors.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((_req, reply) => {
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

    // Anything unrecognised is a bug. Log it with the request id; tell the client nothing.
    req.log.error({ err, reqId: req.id }, 'unhandled error');
    reply.status(500).send({ error: { code: 'INTERNAL', message: 'internal server error' } });
  });
}
