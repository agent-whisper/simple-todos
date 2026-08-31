import { ChangePasswordRequest, LoginRequest } from '@simple-todos/shared';
import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../../services/authService.js';

export interface AuthRouteDeps {
  auth: AuthService;
}

/** Unauthenticated on purpose: this is how a client obtains a token in the first place. */
export async function authPublicRoutes(app: FastifyInstance, deps: AuthRouteDeps): Promise<void> {
  const { auth } = deps;

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { username, password } = LoginRequest.parse(req.body);
    return auth.login(username, password);
  });
}

/** Registered inside the authenticated scope in app.ts; no per-route preHandler needed. */
export async function authPrivateRoutes(app: FastifyInstance, deps: AuthRouteDeps): Promise<void> {
  const { auth } = deps;

  app.get('/auth/me', async () => auth.me());

  app.post('/auth/password', async (req, reply) => {
    const { currentPassword, newPassword } = ChangePasswordRequest.parse(req.body);
    await auth.changePassword(currentPassword, newPassword);
    reply.status(204).send();
  });
}
