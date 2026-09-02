import type { NoteRowValue } from '@simple-todos/shared';
import { useState } from 'react';
import { useNotes, useUpdateTask } from '../api/hooks';
import './screens.css';

const STATUS_LABEL: Record<NoteRowValue['status'], string> = {
  active: 'Active',
  done: 'Done',
  archived: 'Archived',
};

function NoteCard({ note }: { note: NoteRowValue }) {
  const [draft, setDraft] = useState(note.notes);
  const update = useUpdateTask();

  return (
    <article className="note">
      <header className="note__head">
        <h2 className="note__title">{note.title}</h2>
        <span className="note__status">{STATUS_LABEL[note.status]}</span>
      </header>

      <label className="visually-hidden" htmlFor={`note-${note.taskId}`}>
        Note on {note.title}
      </label>
      <textarea
        id={`note-${note.taskId}`}
        className="note__text"
        value={draft}
        rows={3}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          // Only save a real change: blurring an untouched note would bump
          // notesUpdatedAt and reorder the list under the reader.
          if (draft !== note.notes) update.mutate({ id: note.taskId, patch: { notes: draft } });
        }}
      />

      <p className="note__dates data">
        added {note.createdAt.slice(0, 10)} · edited {note.notesUpdatedAt.slice(0, 10)}
        {note.completedAt ? ` · done ${note.completedAt.slice(0, 10)}` : ''}
      </p>
    </article>
  );
}

export function NotesScreen() {
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('all');
  const [q, setQ] = useState('');
  const notes = useNotes({ status, q: q || undefined });

  return (
    <section>
      <h1 className="screen__title">Notes</h1>

      <div className="filters">
        <span className="filters__group">
          <label htmlFor="note-status">Show</label>
          <select
            id="note-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as 'active' | 'archived' | 'all')}
          >
            <option value="all">Everything</option>
            <option value="active">Still on the list</option>
            <option value="archived">Filed away</option>
          </select>
        </span>

        <span className="filters__group filters__group--grow">
          <label htmlFor="note-q">Search notes</label>
          <input
            id="note-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Any word"
          />
        </span>
      </div>

      {notes.data?.notes.length === 0 && (
        <p className="empty">
          Notes you attach to tasks will collect here, newest first — including notes on tasks that
          have long been filed away.
        </p>
      )}

      {(notes.data?.notes ?? []).map((note) => (
        <NoteCard key={note.taskId} note={note} />
      ))}
    </section>
  );
}
