import {
  PRIORITIES,
  type CategoryValue,
  type CreateTaskRequestValue,
  type UpdateTaskRequestValue,
  type PriorityValue,
  type TaskFilterValue,
  type TaskNode,
} from '@simple-todos/shared';
import { useState } from 'react';
import {
  useArchiveTask,
  useCategories,
  useCompleteTask,
  useCreateTask,
  useDeleteTask,
  useSettings,
  useTasks,
  useUncompleteTask,
  useUpdateTask,
} from '../api/hooks';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TaskDialog, type TaskDialogTarget } from '../components/TaskDialog';
import { TaskRow } from '../components/TaskRow';
import './screens.css';

const PRIORITY_LABEL: Record<PriorityValue, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
};

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
  const [dialog, setDialog] = useState<TaskDialogTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TaskNode | null>(null);
  const [pendingArchive, setPendingArchive] = useState<TaskNode | null>(null);

  const settings = useSettings();
  const tasks = useTasks(filter);
  const categories = useCategories();
  const create = useCreateTask();
  const complete = useCompleteTask();
  const uncomplete = useUncompleteTask();
  const remove = useDeleteTask();
  const update = useUpdateTask();
  const archive = useArchiveTask();

  // The API already returns date-only fields in the user's zone; deriving
  // "today" the same way keeps the overdue comparison a plain string compare.
  const timeZone = settings.data?.timezone ?? 'UTC';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

  const isFiltered = Boolean(filter.priority || filter.categoryId || filter.q);
  const groups = groupByCategory(tasks.data ?? [], categories.data ?? []);

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
      </div>

      {tasks.isPending && <p className="muted">Loading…</p>}

      {tasks.isError && (
        <p role="alert" className="error">
          The list could not be loaded. Check the server is running.
        </p>
      )}

      {tasks.data &&
        groups.map((group) => (
          <section key={group.key} className="group" aria-labelledby={`group-${group.key}`}>
            <div className="group__head">
              <h2 id={`group-${group.key}`} className="group__heading">
                {group.name}
              </h2>
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

            {group.roots.length === 0 ? (
              <p className="group__empty">
                {isFiltered ? '(no matches)' : (group.emptyText ?? '(no active tasks)')}
              </p>
            ) : (
              <ul className="tasks">
                {group.roots.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    today={today}
                    categories={categories.data ?? []}
                    onToggle={toggle}
                    onDelete={setPendingDelete}
                    onArchive={setPendingArchive}
                    onAddSubtask={(t) => setDialog({ mode: 'add', label: t.title, parentId: t.id })}
                    onEdit={(t) => setDialog({ mode: 'edit', task: t })}
                    groupCategoryId={group.showChips ? undefined : group.categoryId}
                  />
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
