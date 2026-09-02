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
  useCategories,
  useCompleteTask,
  useCreateTask,
  useDeleteTask,
  useSettings,
  useTasks,
  useUncompleteTask,
  useUpdateTask,
} from '../api/hooks';
import { TaskDialog, type TaskDialogTarget } from '../components/TaskDialog';
import { TaskRow } from '../components/TaskRow';
import './screens.css';

const PRIORITY_LABEL: Record<PriorityValue, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
};

/** Uncategorised tasks get their own group, first, under a name of their own. */
const LOOSE = { id: null, name: 'Active Tasks' } as const;

interface Group {
  key: string;
  name: string;
  categoryId: string | undefined;
  roots: TaskNode[];
}

/**
 * Group root tasks by category.
 *
 * Grouping is by the ROOT's category, not each task's own, so a tree is never
 * split across two sections — a subtask filed under a different category still
 * belongs under its parent, where it makes sense.
 */
function groupByCategory(roots: TaskNode[], categories: CategoryValue[]): Group[] {
  const loose = roots.filter((t) => t.categoryId === null);
  const groups: Group[] = [
    { key: 'loose', name: LOOSE.name, categoryId: undefined, roots: loose },
  ];

  for (const category of categories) {
    groups.push({
      key: category.id,
      name: category.name,
      categoryId: category.id,
      roots: roots.filter((t) => t.categoryId === category.id),
    });
  }

  return groups;
}

export function ActiveScreen() {
  const [filter, setFilter] = useState<TaskFilterValue>({});
  const [dialog, setDialog] = useState<TaskDialogTarget | null>(null);

  const settings = useSettings();
  const tasks = useTasks(filter);
  const categories = useCategories();
  const create = useCreateTask();
  const complete = useCompleteTask();
  const uncomplete = useUncompleteTask();
  const remove = useDeleteTask();
  const update = useUpdateTask();

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
            </div>

            {group.roots.length === 0 ? (
              <p className="group__empty">{isFiltered ? '(no matches)' : '(no active tasks)'}</p>
            ) : (
              <ul className="tasks">
                {group.roots.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    today={today}
                    categories={categories.data ?? []}
                    onToggle={toggle}
                    onDelete={(t) => remove.mutate(t.id)}
                    onAddSubtask={(t) => setDialog({ mode: 'add', label: t.title, parentId: t.id })}
                    onEdit={(t) => setDialog({ mode: 'edit', task: t })}
                    groupCategoryId={group.categoryId}
                  />
                ))}
              </ul>
            )}
          </section>
        ))}

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
