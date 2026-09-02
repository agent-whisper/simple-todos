import type { CategoryValue, TaskNode } from '@simple-todos/shared';

const PRIORITY_LABEL = { must: 'Must', should: 'Should', could: 'Could' } as const;

/**
 * Inline SVG rather than a glyph: `+`, a pencil and `×` from the body font
 * render at wildly different weights and sizes, and some fonts turn the pencil
 * into an emoji. These are all on the same 16px grid and inherit currentColor.
 */
const ICONS = {
  add: 'M8 3.5v9M3.5 8h9',
  edit: 'M11.5 2.5l2 2L6 12l-2.5.5L4 10z',
  remove: 'M4 4l8 8M12 4l-8 8',
} as const;

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export interface TaskRowProps {
  task: TaskNode;
  today: string;
  categories: CategoryValue[];
  onToggle: (task: TaskNode) => void;
  onDelete: (task: TaskNode) => void;
  onAddSubtask: (task: TaskNode) => void;
  onEdit: (task: TaskNode) => void;
  /** The category of the group this row sits in, so its chip is not repeated. */
  groupCategoryId?: string;
}

/**
 * One line of the ledger.
 *
 * Priority is encoded as the weight of the left rule — the three levels are
 * ordered, and weight carries order where hue cannot. The text label is always
 * present too, so the encoding is never the only channel.
 */
export function TaskRow({
  task,
  today,
  categories,
  onToggle,
  onDelete,
  onAddSubtask,
  onEdit,
  groupCategoryId,
}: TaskRowProps) {
  const done = task.completedAt !== null;
  const overdue = !done && task.dueDate !== null && task.dueDate < today;

  // Only show the chip when it says something the group heading does not — a
  // subtask filed under a different category than its tree.
  const category =
    task.categoryId !== null && task.categoryId !== (groupCategoryId ?? null)
      ? categories.find((c) => c.id === task.categoryId)
      : undefined;

  return (
    <li>
      <div className={`task task--${task.priority}${done ? ' task--done' : ''}`}>
        <input
          type="checkbox"
          className="task__check"
          checked={done}
          onChange={() => onToggle(task)}
          aria-label={task.title}
        />

        <span className="task__body">
          <span className="task__title">{task.title}</span>
          <span className="task__meta">
            <span className="task__priority">{PRIORITY_LABEL[task.priority]}</span>
            {category && (
              <span className="chip" style={{ borderLeftColor: category.color }}>
                {category.name}
              </span>
            )}
            {task.recurrenceId && <span className="task__repeat">repeats</span>}
            {task.notes && <span className="task__note">{task.notes}</span>}
          </span>
        </span>

        <span className="task__right">
          {task.dueDate && (
            <span className={`task__due data${overdue ? ' task__due--overdue' : ''}`}>
              {task.dueDate}
              {overdue && <span className="visually-hidden"> (overdue)</span>}
            </span>
          )}

          <span className="task__actions">
            <button type="button" className="task__action" onClick={() => onAddSubtask(task)}>
              <Icon path={ICONS.add} />
              <span className="visually-hidden">Add a subtask to {task.title}</span>
            </button>
            <button type="button" className="task__action" onClick={() => onEdit(task)}>
              <Icon path={ICONS.edit} />
              <span className="visually-hidden">Edit {task.title}</span>
            </button>
            <button
              type="button"
              className="task__action task__action--danger"
              onClick={() => onDelete(task)}
            >
              <Icon path={ICONS.remove} />
              <span className="visually-hidden">Delete {task.title}</span>
            </button>
          </span>
        </span>
      </div>

      {task.children.length > 0 && (
        <ul className="task__children">
          {task.children.map((child) => (
            <TaskRow
              key={child.id}
              task={child}
              today={today}
              categories={categories}
              onToggle={onToggle}
              onDelete={onDelete}
              onAddSubtask={onAddSubtask}
              onEdit={onEdit}
              groupCategoryId={groupCategoryId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
