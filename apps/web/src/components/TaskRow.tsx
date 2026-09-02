import type { CategoryValue, TaskNode } from '@simple-todos/shared';

const PRIORITY_LABEL = { must: 'Must', should: 'Should', could: 'Could' } as const;

export interface TaskRowProps {
  task: TaskNode;
  today: string;
  categories: CategoryValue[];
  onToggle: (task: TaskNode) => void;
  onDelete: (task: TaskNode) => void;
}

/**
 * One line of the ledger.
 *
 * Priority is encoded as the weight of the left rule — the three levels are
 * ordered, and weight carries order where hue cannot. The text label is always
 * present too, so the encoding is never the only channel.
 */
export function TaskRow({ task, today, categories, onToggle, onDelete }: TaskRowProps) {
  const done = task.completedAt !== null;
  const overdue = !done && task.dueDate !== null && task.dueDate < today;
  const category = categories.find((c) => c.id === task.categoryId);

  return (
    <li>
      <div className={`task task--${task.priority}${done ? ' task--done' : ''}`}>
        <input
          type="checkbox"
          checked={done}
          onChange={() => onToggle(task)}
          aria-label={task.title}
        />

        <span className="task__body">
          <span className="task__title">{task.title}</span>
          <span className="task__meta">
            <span className="task__priority">{PRIORITY_LABEL[task.priority]}</span>
            {category && (
              <span className="chip" style={{ borderColor: category.color }}>
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
          <button type="button" className="task__delete" onClick={() => onDelete(task)}>
            <span className="visually-hidden">Delete {task.title}</span>
            <span aria-hidden="true">×</span>
          </button>
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
            />
          ))}
        </ul>
      )}
    </li>
  );
}
