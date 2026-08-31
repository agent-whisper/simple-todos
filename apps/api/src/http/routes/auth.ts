import { ChangePasswordRequest, LoginRequest } from '@simple-todos/shared';
import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../../services/authService.js';

export interface AuthRouteDeps {
  auth: AuthService;
  requireAuth: (req: never, reply: never) => Promise<void>;
}

export async function authRoutes(app: FastifyInstance, deps: AuthRouteDeps): Promise<void> {
  const { auth, requireAuth } = deps;

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { username, password } = LoginRequest.parse(req.body);
    return auth.login(username, password);
  });

  app.get('/auth/me', { preHandler: requireAuth as never }, async () => auth.me());

  app.post('/auth/password', { preHandler: requireAuth as never }, async (req, reply) => {
    const { currentPassword, newPassword } = ChangePasswordRequest.parse(req.body);
    await auth.changePassword(currentPassword, newPassword);
    reply.status(204).send();
  });
}
