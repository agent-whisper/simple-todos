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
