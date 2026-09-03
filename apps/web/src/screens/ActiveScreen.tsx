import {
  PRIORITIES,
  type CategoryValue,
  type CreateTaskRequestValue,
  type UpdateTaskRequestValue,
  type PriorityValue,
  type TaskFilterValue,
  type TaskNode,
} from '@simple-todos/shared';
import { Fragment, useCallback, useState } from 'react';
import {
  useArchiveTask,
  useCategories,
  useCompleteTask,
  useCreateTask,
  useDeleteTask,
  useMoveTask,
  useSettings,
  useTasks,
  useUncompleteTask,
  useUpdateTask,
} from '../api/hooks';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TaskDialog, type TaskDialogTarget } from '../components/TaskDialog';
import { DropGap, TaskRow } from '../components/TaskRow';
import { useCollapsed } from './useCollapsed';
import { useSearchFold } from './useSearchFold';
import { positionFor, useTaskDrag, type DropTarget } from './useTaskDrag';
import './screens.css';

const PRIORITY_LABEL: Record<PriorityValue, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
};

/** Every task on the screen that has something to fold, at any depth. */
function foldableTaskIds(roots: TaskNode[], into: string[] = []): string[] {
  for (const task of roots) {
    if (task.children.length > 0) into.push(task.id);
    foldableTaskIds(task.children, into);
  }
  return into;
}

/** Every task beneath this one, at any depth. */
function countDescendants(task: TaskNode): number {
  return task.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

/**
 * Deleting cascades to the whole subtree, and nothing on the row hints at that,
 * so the count is the part of this sentence that earns its place.
 */
function deleteWarning(task: TaskNode): string {
  const n = countDescendants(task);
  if (n === 0) return 'This cannot be undone.';
  return `Its ${n} subtask${n === 1 ? '' : 's'} will be deleted too. This cannot be undone.`;
}

/**
 * Archiving is a whole-tree operation — nothing carries archived_at without
 * completed_at, and a tree is archived atomically — so the confirmation says
 * both of the things a button on one row cannot.
 */
function archiveWarning(task: TaskNode): string {
  const n = countDescendants(task);
  const scope =
    n === 0
      ? 'It will be marked done and filed away.'
      : `The whole tree goes with it — ${n} subtask${n === 1 ? '' : 's'} — and anything unfinished is marked done.`;
  return `${scope} You can find it again on the Archive screen.`;
}

/** Uncategorised tasks get their own group, first, under a name of their own. */
const LOOSE = { id: null, name: 'Active Tasks' } as const;

interface Group {
  key: string;
  name: string;
  categoryId: string | undefined;
  roots: TaskNode[];
  /** Repeats are made on the Repeating screen, not added ad hoc here. */
  addable: boolean;
  /** No heading names the category there, so the chip has to. */
  showChips: boolean;
  /** Overrides the default "(no active tasks)" where that would not be true. */
  emptyText?: string;
}

/**
 * Group root tasks by category.
 *
 * Grouping is by the ROOT's category, not each task's own, so a tree is never
 * split across two sections — a subtask filed under a different category still
 * belongs under its parent, where it makes sense.
 */
function groupByCategory(allRoots: TaskNode[], categories: CategoryValue[]): Group[] {
  // Today's habits are a different kind of thing from project work — a fixed
  // daily rhythm rather than something you chose to start — so they get their
  // own section instead of being sprinkled through the category groups.
  const repeats = allRoots.filter((t) => t.recurrenceId !== null);
  const roots = allRoots.filter((t) => t.recurrenceId === null);

  const groups: Group[] = [];

  // First, because a repeat is the only thing here with a hard expiry: at the
  // nightly sweep an untouched one is deleted and recorded as a miss. Always
  // present, even on a quiet day — a missing header would read as "you have no
  // habits" rather than "none are due today", which are different things.
  groups.push({
    key: 'repeating',
    name: 'Repeating today',
    categoryId: undefined,
    roots: repeats,
    addable: false,
    showChips: true,
    emptyText: 'Nothing repeating today.',
  });

  groups.push(
    {
      key: 'loose',
      name: LOOSE.name,
      categoryId: undefined,
      roots: roots.filter((t) => t.categoryId === null),
      addable: true,
      showChips: false,
    },
  );

  for (const category of categories) {
    groups.push({
      key: category.id,
      name: category.name,
      categoryId: category.id,
      roots: roots.filter((t) => t.categoryId === category.id),
      addable: true,
      showChips: false,
    });
  }

  return groups;
}

export function ActiveScreen() {
  const [filter, setFilter] = useState<TaskFilterValue>({});
  // Not persisted: a mode you would come back to tomorrow and mistake for an
  // empty list. The button is right there when you want it again.
  const [focusMode, setFocusMode] = useState(false);
  const [dialog, setDialog] = useState<TaskDialogTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TaskNode | null>(null);
  const [pendingArchive, setPendingArchive] = useState<TaskNode | null>(null);
  const groupFold = useCollapsed('simple-todos.collapsed.groups');
  const taskFold = useCollapsed('simple-todos.collapsed.tasks');

  const settings = useSettings();
  const tasks = useTasks(focusMode ? { ...filter, workingOn: true } : filter);
  const categories = useCategories();
  const create = useCreateTask();
  const complete = useCompleteTask();
  const uncomplete = useUncompleteTask();
  const remove = useDeleteTask();
  const update = useUpdateTask();
  const archive = useArchiveTask();
  const moveTask = useMoveTask();

  const drag = useTaskDrag(
    useCallback(
      (id: string, target: DropTarget) =>
        moveTask.mutate({
          id,
          parentId: target.parentId,
          position: positionFor(target),
          // Omitted, not null: leaving it out means "keep the category", which
          // is what a drop onto another task should do.
          ...(target.categoryId !== undefined ? { categoryId: target.categoryId } : {}),
        }),
      [moveTask],
    ),
  );

  // The API already returns date-only fields in the user's zone; deriving
  // "today" the same way keeps the overdue comparison a plain string compare.
  const timeZone = settings.data?.timezone ?? 'UTC';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

  const isFiltered = Boolean(filter.priority || filter.categoryId || filter.q);
  const allGroups = groupByCategory(tasks.data ?? [], categories.data ?? []);
  // Headings normally stay put even when empty, so a category never looks
  // deleted. In focus mode that would be a column of "(no matches)" instead of
  // a focused screen, so the empty ones drop out.
  const groups = focusMode ? allGroups.filter((group) => group.roots.length > 0) : allGroups;

  // While searching, the fold follows the hits rather than what you last left
  // folded, and reverts to your own state when the search box empties.
  const searchFold = useSearchFold(filter.q ?? '', tasks.data ?? []);
  const fold = filter.q ? searchFold : taskFold;

  function toggle(task: TaskNode) {
    if (task.completedAt === null) complete.mutate(task.id);
    else uncomplete.mutate(task.id);
  }

  function confirmDelete(taskToDelete: TaskNode) {
    remove.mutate(taskToDelete.id, { onSuccess: () => setPendingDelete(null) });
  }

  function confirmArchive(taskToArchive: TaskNode) {
    archive.mutate(taskToArchive.id, { onSuccess: () => setPendingArchive(null) });
  }

  function addTask(input: CreateTaskRequestValue) {
    create.mutate(input, { onSuccess: () => setDialog(null) });
  }

  function editTask(id: string, patch: UpdateTaskRequestValue) {
    update.mutate({ id, patch }, { onSuccess: () => setDialog(null) });
  }

  function foldEverything(collapsed: boolean) {
    const groupKeys = groups.map((group) => group.key);
    const taskIds = foldableTaskIds(tasks.data ?? []);
    // `fold` rather than taskFold: while a search is running it is the search's
    // own fold that is on screen, and a button that moved the other one would
    // look broken.
    if (collapsed) {
      groupFold.collapseAll(groupKeys);
      fold.collapseAll(taskIds);
    } else {
      groupFold.expandAll(groupKeys);
      fold.expandAll(taskIds);
    }
  }

  function patchFilter(part: Partial<TaskFilterValue>) {
    setFilter((current) => {
      const next = { ...current, ...part };
      for (const key of Object.keys(next) as (keyof TaskFilterValue)[]) {
        if (!next[key]) delete next[key];
      }
      return next;
    });
  }

  return (
    <section>
      <h1 className="screen__title">Active</h1>

      <div className="filters">
        <span className="filters__group">
          <label htmlFor="filter-priority">Priority</label>
          <select
            id="filter-priority"
            value={filter.priority ?? ''}
            onChange={(e) => patchFilter({ priority: (e.target.value || undefined) as PriorityValue })}
          >
            <option value="">Any</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </span>

        <span className="filters__group filters__group--grow">
          <label htmlFor="filter-q">Search</label>
          <input
            id="filter-q"
            value={filter.q ?? ''}
            onChange={(e) => patchFilter({ q: e.target.value || undefined })}
            placeholder="Title or note"
          />
        </span>

        <span className="filters__fold">
          <button
            type="button"
            className={`toggle${focusMode ? ' toggle--on' : ''}`}
            aria-pressed={focusMode}
            onClick={() => setFocusMode((on) => !on)}
          >
            Focus mode
          </button>
          <button type="button" onClick={() => foldEverything(true)}>
            Collapse all
          </button>
          <button type="button" onClick={() => foldEverything(false)}>
            Expand all
          </button>
        </span>
      </div>

      {tasks.isPending && <p className="muted">Loading…</p>}

      {tasks.isError && (
        <p role="alert" className="error">
          The list could not be loaded. Check the server is running.
        </p>
      )}

      {tasks.data &&
        groups.map((group) => (
          <section
            key={group.key}
            className="group"
            aria-labelledby={`group-${group.key}`}
            {...(group.addable
              ? (drag.zone(`group:${group.key}`, {
                  parentId: null,
                  siblings: group.roots,
                  slot: group.roots.length,
                  categoryId: group.categoryId ?? null,
                }) ?? {})
              : {})}
          >
            <div className="group__head">
              <button
                type="button"
                className={`group__fold${groupFold.isCollapsed(group.key) ? '' : ' group__fold--open'}`}
                aria-expanded={!groupFold.isCollapsed(group.key)}
                onClick={() => groupFold.toggle(group.key)}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                  <path
                    d="M6 4l4 4-4 4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="visually-hidden">
                  {groupFold.isCollapsed(group.key) ? 'Expand' : 'Collapse'} {group.name}
                </span>
              </button>

              <h2 id={`group-${group.key}`} className="group__heading">
                {group.name}
              </h2>

              {groupFold.isCollapsed(group.key) && group.roots.length > 0 && (
                <span className="group__count data">
                  {group.roots.length} task{group.roots.length === 1 ? '' : 's'}
                </span>
              )}
              {group.addable && (
                <button
                  type="button"
                  className="group__add"
                  onClick={() =>
                    setDialog({ mode: 'add', label: group.name, categoryId: group.categoryId })
                  }
                >
                  <span aria-hidden="true">+</span>
                  <span className="visually-hidden">Add a task to {group.name}</span>
                </button>
              )}
            </div>

            {groupFold.isCollapsed(group.key) ? null : group.roots.length === 0 ? (
              <p className="group__empty">
                {isFiltered ? '(no matches)' : (group.emptyText ?? '(no active tasks)')}
              </p>
            ) : (
              <ul className="tasks">
                {group.addable && (
                  <DropGap
                    drag={drag}
                    parentId={null}
                    siblings={group.roots}
                    slot={0}
                    categoryId={group.categoryId ?? null}
                  />
                )}
                {group.roots.map((task, i) => (
                  <Fragment key={task.id}>
                  <TaskRow
                    task={task}
                    today={today}
                    categories={categories.data ?? []}
                    onToggle={toggle}
                    onDelete={setPendingDelete}
                    onArchive={setPendingArchive}
                    onWorkingOn={(t, working) =>
                      update.mutate({ id: t.id, patch: { workingOn: working } })
                    }
                    onAddSubtask={(t) =>
                      setDialog({ mode: 'add', label: t.title, parentId: t.id, priority: t.priority })
                    }
                    onEdit={(t) => setDialog({ mode: 'edit', task: t })}
                    isCollapsed={fold.isCollapsed}
                    onToggleCollapsed={fold.toggle}
                    groupCategoryId={group.showChips ? undefined : group.categoryId}
                    drag={drag}
                  />
                  {group.addable && (
                    <DropGap
                      drag={drag}
                      parentId={null}
                      siblings={group.roots}
                      slot={i + 1}
                      categoryId={group.categoryId ?? null}
                    />
                  )}
                  </Fragment>
                ))}
              </ul>
            )}
          </section>
        ))}

      {pendingArchive && (
        <ConfirmDialog
          heading={`Archive ${pendingArchive.title}?`}
          body={archiveWarning(pendingArchive)}
          confirmLabel="Archive"
          onConfirm={() => confirmArchive(pendingArchive)}
          onCancel={() => setPendingArchive(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          heading={`Delete ${pendingDelete.title}?`}
          body={deleteWarning(pendingDelete)}
          confirmLabel="Delete"
          onConfirm={() => confirmDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {dialog && (
        <TaskDialog
          target={dialog}
          categories={categories.data ?? []}
          onClose={() => setDialog(null)}
          onAdd={addTask}
          onEdit={editTask}
        />
      )}
    </section>
  );
}
