import { CreateCategoryRequest, UpdateCategoryRequest } from '@simple-todos/shared';
import type { FastifyInstance } from 'fastify';
import type { CategoryService } from '../../services/categoryService.js';

export interface CategoryRouteDeps {
  categories: CategoryService;
}

/** Registered inside the authenticated scope in app.ts; no per-route preHandler needed. */
export async function categoryRoutes(app: FastifyInstance, deps: CategoryRouteDeps): Promise<void> {
  const { categories } = deps;

  app.get('/categories', async () => categories.list());

  app.post('/categories', async (req, reply) => {
    const category = categories.create(CreateCategoryRequest.parse(req.body));
    reply.status(201);
    return category;
  });

  app.patch('/categories/:id', async (req) =>
    categories.update((req.params as { id: string }).id, UpdateCategoryRequest.parse(req.body)),
  );

  app.delete('/categories/:id', async (req, reply) => {
    categories.remove((req.params as { id: string }).id);
    reply.status(204).send();
  });
}
