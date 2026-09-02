import {
  PRIORITIES,
  type CategoryValue,
  type CreateTaskRequestValue,
  type PriorityValue,
  type TaskNode,
  type UpdateTaskRequestValue,
} from '@simple-todos/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';

const PRIORITY_LABEL: Record<PriorityValue, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
};

/** Adding something new, under a category or a parent task. */
export interface AddTarget {
  mode: 'add';
  /** What it is being added to, for the heading. */
  label: string;
  /** Pre-decided and not shown: a picker here would only be a way to get it wrong. */
  categoryId?: string;
  /** Set when adding a subtask; the API inherits the parent's category. */
  parentId?: string;
}

/** Changing one that already exists. */
export interface EditTarget {
  mode: 'edit';
  task: TaskNode;
}

export type TaskDialogTarget = AddTarget | EditTarget;

export interface TaskDialogProps {
  target: TaskDialogTarget;
  categories: CategoryValue[];
  onClose: () => void;
  onAdd: (input: CreateTaskRequestValue) => void;
  onEdit: (id: string, patch: UpdateTaskRequestValue) => void;
}

/**
 * A native <dialog> rather than a hand-rolled overlay: the browser gives focus
 * trapping, Escape to close, and an inert background for free, and gets them
 * right in ways hand-rolled modals usually do not.
 */
export function TaskDialog({ target, categories, onClose, onAdd, onEdit }: TaskDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const editing = target.mode === 'edit' ? target.task : null;

  const [title, setTitle] = useState(editing?.title ?? '');
  const [priority, setPriority] = useState<PriorityValue>(editing?.priority ?? 'should');
  const [dueDate, setDueDate] = useState(editing?.dueDate ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? '');

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    // Refuse rather than create a blank task: the dialog stays open with the
    // field focused, which is more useful than a disabled button whose reason
    // the reader has to work out.
    if (!trimmed) {
      ref.current?.querySelector<HTMLInputElement>('#dialog-title')?.focus();
      return;
    }

    if (target.mode === 'edit') {
      // Send every field: null clears a deadline or note, which is a thing the
      // reader will want and which omitting the key could never express.
      onEdit(target.task.id, {
        title: trimmed,
        priority,
        dueDate: dueDate || null,
        notes: notes.trim() || null,
        categoryId: categoryId || null,
      });
      return;
    }

    onAdd({
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
          {target.mode === 'edit' ? `Edit ${target.task.title}` : `Add to ${target.label}`}
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

        {/*
          Only when editing. On add, the button that was pressed already decided
          the category; on edit this is the only place a misfiled task can be
          moved between groups.
        */}
        {editing && (
          <div className="dialog__field">
            <label htmlFor="dialog-category">Category</label>
            <select
              id="dialog-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Active Tasks</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

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
            {editing ? 'Save changes' : 'Add task'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
