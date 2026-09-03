import type { CategoryValue, TaskNode } from '@simple-todos/shared';
import { Fragment } from 'react';
import type { TaskDrag } from '../screens/useTaskDrag';

/** Whole days from one YYYY-MM-DD to another. Both are already local dates. */
function daysUntil(from: string, to: string): number {
  const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/**
 * "3 days left" answers the question you actually have; a date makes you do the
 * arithmetic yourself. The date is still there, a hover away, for when you are
 * planning rather than triaging.
 */
function countdown(today: string, due: string): string {
  const days = daysUntil(today, due);
  if (days === 0) return 'today!';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `${days} days left` : `${-days} days late`;
}

function DueDate({ due, today, overdue }: { due: string; today: string; overdue: boolean }) {
  return (
    <span className={`task__due${overdue ? ' task__due--overdue' : ''}`}>
      <span className="task__due-slide">
        <span className="task__due-near">{countdown(today, due)}</span>
        <span className="task__due-date data">{due}</span>
      </span>
      {overdue && <span className="visually-hidden"> (overdue)</span>}
    </span>
  );
}

/**
 * A landing strip between two rows.
 *
 * Only rendered mid-drag, and only where the drop is legal — an inert gap that
 * shifts the list around on every hover would be noise.
 */
function DropGap({
  drag,
  parentId,
  siblings,
  slot,
  categoryId,
}: {
  drag: TaskDrag;
  parentId: string | null;
  siblings: TaskNode[];
  slot: number;
  categoryId?: string | null;
}) {
  const zone = drag.zone(`gap:${parentId ?? 'root'}:${categoryId ?? ''}:${slot}`, {
    parentId,
    siblings,
    slot,
    ...(categoryId !== undefined ? { categoryId } : {}),
  });
  if (!zone) return null;
  return <li className="dropgap" data-drop="" aria-hidden="true" {...zone} />;
}

export { DropGap };

const PRIORITY_LABEL = { must: 'Must', should: 'Should', could: 'Could' } as const;

/**
 * Inline SVG rather than a glyph: `+`, a pencil and `×` from the body font
 * render at wildly different weights and sizes, and some fonts turn the pencil
 * into an emoji. These are all on the same 16px grid and inherit currentColor.
 */
const ICONS = {
  add: 'M8 3.5v9M3.5 8h9',
  edit: 'M11.5 2.5l2 2L6 12l-2.5.5L4 10z',
  archive: 'M2.5 4.5h11v2h-11zM3.5 6.5v7h9v-7M6.5 9h3',
  chevron: 'M6 4l4 4-4 4',
  // A ring with a dot in it: what you have your eye on.
  focus: 'M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 100-11M8 7.2a.8.8 0 100 1.6.8.8 0 100-1.6',
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
  onArchive: (task: TaskNode) => void;
  onWorkingOn: (task: TaskNode, working: boolean) => void;
  isCollapsed: (id: string) => boolean;
  onToggleCollapsed: (id: string) => void;
  /** The category of the group this row sits in, so its chip is not repeated. */
  groupCategoryId?: string;
  /** Absent on screens with no order to arrange, such as Working on. */
  drag?: TaskDrag;
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
  onArchive,
  onWorkingOn,
  isCollapsed,
  onToggleCollapsed,
  groupCategoryId,
  drag,
}: TaskRowProps) {
  const hasChildren = task.children.length > 0;
  const folded = hasChildren && isCollapsed(task.id);
  const done = task.completedAt !== null;
  const working = task.workingOnAt !== null;
  const overdue = !done && task.dueDate !== null && task.dueDate < today;

  // Only show the chip when it says something the group heading does not — a
  // subtask filed under a different category than its tree.
  const category =
    task.categoryId !== null && task.categoryId !== (groupCategoryId ?? null)
      ? categories.find((c) => c.id === task.categoryId)
      : undefined;

  // The nightly sweep owns repeating instances — it spawns them each morning
  // and clears them at night — so a move would be undone within the day.
  const movable = drag !== undefined && task.recurrenceId === null;
  const grip = drag && movable ? drag.source(task) : null;
  const into =
    drag && movable
      ? drag.zone(`into:${task.id}`, {
          parentId: task.id,
          siblings: task.children,
          slot: task.children.length,
        })
      : null;
  const dragging = drag?.active?.id === task.id;

  return (
    <li>
      <div
        className={`task task--${task.priority}${done ? ' task--done' : ''}${working ? ' task--working' : ''}${dragging ? ' task--dragging' : ''}`}
        {...(into ?? {})}
      >
        {/*
          A handle rather than a draggable row. With the whole row draggable,
          whether a drag started depended on where you happened to grab: the
          checkbox, the twisty and the four action buttons all swallow it, and
          pressing on the title starts a text selection instead.

          The handle holds no elements. Its dots are painted by a pseudo-element,
          which is not a hit-test target, so a press always lands on the handle
          itself. An <svg> here would be what the press landed on instead, and an
          SVG carries no draggable attribute — which is why the drag never
          started at all.

          Hidden from the accessible tree because dragging is pointer-only —
          there is nothing here for a keyboard to do.
        */}
        <span className="task__grip-slot">
          {grip && <span className="task__grip" aria-hidden="true" {...grip} />}
        </span>
        {/* A fixed-width slot either way, so titles line up whether or not a
            row has subtasks to fold. */}
        <span className="task__twisty">
          {hasChildren && (
            <button
              type="button"
              className={`task__fold${folded ? '' : ' task__fold--open'}`}
              aria-expanded={!folded}
              onClick={() => onToggleCollapsed(task.id)}
            >
              <Icon path={ICONS.chevron} />
              <span className="visually-hidden">
                {folded ? 'Expand' : 'Collapse'} subtasks of {task.title}
              </span>
            </button>
          )}
        </span>

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
          {task.dueDate && <DueDate due={task.dueDate} today={today} overdue={overdue} />}

          <span className="task__actions">
            <button type="button" className="task__action" onClick={() => onAddSubtask(task)}>
              <Icon path={ICONS.add} />
              <span className="visually-hidden">Add a subtask to {task.title}</span>
            </button>
            <button
              type="button"
              className={`task__action${working ? ' task__action--on' : ''}`}
              aria-pressed={working}
              onClick={() => onWorkingOn(task, !working)}
            >
              <Icon path={ICONS.focus} />
              <span className="visually-hidden">
                {working ? 'Stop' : 'Start'} working on {task.title}
              </span>
            </button>
            <button type="button" className="task__action" onClick={() => onEdit(task)}>
              <Icon path={ICONS.edit} />
              <span className="visually-hidden">Edit {task.title}</span>
            </button>
            <button type="button" className="task__action" onClick={() => onArchive(task)}>
              <Icon path={ICONS.archive} />
              <span className="visually-hidden">Archive {task.title}</span>
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

      {hasChildren && !folded && (
        <ul className="task__children">
          {drag && <DropGap drag={drag} parentId={task.id} siblings={task.children} slot={0} />}
          {task.children.map((child, i) => (
            <Fragment key={child.id}>
            <TaskRow
              task={child}
              today={today}
              categories={categories}
              onToggle={onToggle}
              onDelete={onDelete}
              onAddSubtask={onAddSubtask}
              onEdit={onEdit}
              onArchive={onArchive}
              onWorkingOn={onWorkingOn}
              isCollapsed={isCollapsed}
              onToggleCollapsed={onToggleCollapsed}
              groupCategoryId={groupCategoryId}
              drag={drag}
            />
            {drag && (
              <DropGap drag={drag} parentId={task.id} siblings={task.children} slot={i + 1} />
            )}
            </Fragment>
          ))}
        </ul>
      )}
    </li>
  );
}
