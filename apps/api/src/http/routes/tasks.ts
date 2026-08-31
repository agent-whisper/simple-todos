import { CreateTaskRequest, MoveTaskRequest, TaskFilter } from '@simple-todos/shared';
import type { FastifyInstance } from 'fastify';
import type { TaskService } from '../../services/taskService.js';

export interface TaskRouteDeps {
  tasks: TaskService;
}

/** Registered inside the authenticated scope in app.ts; no per-route preHandler needed. */
export async function taskRoutes(app: FastifyInstance, deps: TaskRouteDeps): Promise<void> {
  const { tasks } = deps;

  app.get('/tasks', async (req) => tasks.listActive(TaskFilter.parse(req.query)));

  app.get('/tasks/:id', async (req) => tasks.get((req.params as { id: string }).id));

  app.post('/tasks', async (req, reply) => {
    const task = tasks.create(CreateTaskRequest.parse(req.body));
    reply.status(201);
    return task;
  });

  app.post('/tasks/:id/complete', async (req) => tasks.complete((req.params as { id: string }).id));

  app.post('/tasks/:id/uncomplete', async (req) => tasks.uncomplete((req.params as { id: string }).id));

  app.post('/tasks/:id/move', async (req) => {
    const { parentId, position } = MoveTaskRequest.parse(req.body);
    return tasks.move((req.params as { id: string }).id, parentId, position);
  });
}
