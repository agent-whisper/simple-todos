import { NotesResponse } from '@simple-todos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeAuthedApp, type AuthedApp } from '../../../test/helpers/testApp.js';

let ctx: AuthedApp;

beforeEach(async () => {
  ctx = await makeAuthedApp();
});

afterEach(async () => {
  await ctx.close();
});

describe('GET /api/notes', () => {
  it('lists tasks that carry a note', async () => {
    await ctx.post('/api/tasks', { title: 'Fix sink', notes: 'washer is worn' });
    await ctx.post('/api/tasks', { title: 'Buy milk' });

    const res = await ctx.get('/api/notes');
    expect(res.statusCode).toBe(200);
    expect(res.json().notes).toHaveLength(1);
    expect(res.json().notes[0].title).toBe('Fix sink');
    expect(NotesResponse.safeParse(res.json()).success).toBe(true);
  });

  it('excludes a note row with a null notesUpdatedAt, which would violate the response schema', async () => {
    const task = (await ctx.post('/api/tasks', { title: 'Fix sink', notes: 'washer is worn' })).json();
    // Simulate a write path (e.g. Plan 2) that sets notes without stamping
    // notes_updated_at, which TaskService always does today but nothing in
    // the schema enforces.
    ctx.db.$client.prepare(`UPDATE task SET notes_updated_at = NULL WHERE id = ?`).run(task.id);

    const res = await ctx.get('/api/notes');
    expect(res.statusCode).toBe(200);
    expect(res.json().notes).toHaveLength(0);
    expect(NotesResponse.safeParse(res.json()).success).toBe(true);
  });

  it('searches note text', async () => {
    await ctx.post('/api/tasks', { title: 'Fix sink', notes: 'washer is worn' });
    await ctx.post('/api/tasks', { title: 'Write spec', notes: 'needs a diagram' });

    expect((await ctx.get('/api/notes?q=washer')).json().notes).toHaveLength(1);
  });

  it('requires a token', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/notes' })).statusCode).toBe(401);
  });
});
