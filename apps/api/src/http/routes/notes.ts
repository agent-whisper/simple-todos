import { NotesQuery } from '@simple-todos/shared';
import type { FastifyInstance } from 'fastify';
import type { NoteService } from '../../services/noteService.js';

export interface NoteRouteDeps {
  notes: NoteService;
}

/** Registered inside the authenticated scope in app.ts; no per-route preHandler needed. */
export async function noteRoutes(app: FastifyInstance, deps: NoteRouteDeps): Promise<void> {
  const { notes } = deps;

  app.get('/notes', async (req) => notes.list(NotesQuery.parse(req.query)));
}
