import type { FastifyReply, FastifyRequest } from 'fastify';
import { UnauthenticatedError } from '../domain/errors.js';
import type { AuthService } from '../services/authService.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: number;
  }
}

/** Registered as a preHandler on every route except health and login. */
export function makeRequireAuth(auth: AuthService) {
  return async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthenticatedError('authentication required');
    }
    const { userId } = await auth.verify(header.slice('Bearer '.length));
    req.userId = userId;
  };
}
