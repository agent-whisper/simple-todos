import type { onRequestAsyncHookHandler } from 'fastify';
import { UnauthenticatedError } from '../domain/errors.js';
import type { AuthService } from '../services/authService.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: number;
  }
}

/**
 * Registered as an `onRequest` hook on the authenticated scope in `app.ts`.
 * Every route inside that scope is protected by construction; there is
 * nothing a route module can forget to attach.
 */
export function makeRequireAuth(auth: AuthService): onRequestAsyncHookHandler {
  return async function requireAuth(req, _reply): Promise<void> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthenticatedError('authentication required');
    }
    const { userId } = await auth.verify(header.slice('Bearer '.length));
    req.userId = userId;
  };
}
