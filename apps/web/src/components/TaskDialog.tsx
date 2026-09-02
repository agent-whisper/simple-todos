import { PRIORITIES, type CreateTaskRequestValue, type PriorityValue } from '@simple-todos/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';

const PRIORITY_LABEL: Record<PriorityValue, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
};

export interface TaskDialogTarget {
  /** What the new task is being added to, for the heading. */
  label: string;
  /** Pre-decided and not shown: the picker would only be a way to get it wrong. */
  categoryId?: string;
  /** Set when adding a subtask; the API inherits the parent's category. */
  parentId?: string;
}

export interface TaskDialogProps {
  target: TaskDialogTarget;
  onClose: () => void;
  onSubmit: (input: CreateTaskRequestValue) => void;
}

/**
 * A native <dialog> rather than a hand-rolled overlay: the browser gives focus
 * trapping, Escape to close, and an inert background for free, and gets them
 * right in ways hand-rolled modals usually do not.
 */
export function TaskDialog({ target, onClose, onSubmit }: TaskDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<PriorityValue>('should');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    // Refuse rather than create a blank task: the dialog stays open with the
    // field focused, which is more useful than a disabled button the reader
    // has to work out the reason for.
    if (!trimmed) {
      ref.current?.querySelector<HTMLInputElement>('#dialog-title')?.focus();
      return;
    }

    onSubmit({
      title: trimmed,
      priority,
      ...(target.categoryId ? { categoryId: target.categoryId } : {}),
      ...(target.parentId ? { parentId: target.parentId } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  }

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="dialog-heading" onClose={onClose}>
      <form className="dialog__form" onSubmit={submit}>
        <h2 id="dialog-heading" className="dialog__heading">
          Add to {target.label}
        </h2>

        <div className="dialog__field">
          <label htmlFor="dialog-title">Title</label>
          <input
            id="dialog-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            autoFocus
          />
        </div>

        <div className="dialog__field">
          <label htmlFor="dialog-priority">Priority</label>
          <select
            id="dialog-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as PriorityValue)}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>

        <div className="dialog__field">
          <label htmlFor="dialog-due">Deadline</label>
          <input
            id="dialog-due"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>

        <div className="dialog__field">
          <label htmlFor="dialog-notes">Note</label>
          <textarea
            id="dialog-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth remembering"
          />
        </div>

        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="dialog__submit">
            Add task
          </button>
        </div>
      </form>
    </dialog>
  );
}
