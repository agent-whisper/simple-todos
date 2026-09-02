import { PRIORITIES, type PriorityValue, type TaskFilterValue, type TaskNode } from '@simple-todos/shared';
import { useState, type FormEvent } from 'react';
import {
  useCategories,
  useCompleteTask,
  useCreateTask,
  useDeleteTask,
  useSettings,
  useTasks,
  useUncompleteTask,
} from '../api/hooks';
import { TaskRow } from '../components/TaskRow';
import './screens.css';

const PRIORITY_LABEL: Record<PriorityValue, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
};

export function ActiveScreen() {
  const [filter, setFilter] = useState<TaskFilterValue>({});
  const [draft, setDraft] = useState('');

  const settings = useSettings();
  const tasks = useTasks(filter);
  const categories = useCategories();
  const create = useCreateTask();
  const complete = useCompleteTask();
  const uncomplete = useUncompleteTask();
  const remove = useDeleteTask();

  // The API already returns date-only fields in the user's zone; deriving
  // "today" the same way keeps the overdue comparison a plain string compare.
  const timeZone = settings.data?.timezone ?? 'UTC';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

  function addTask(event: FormEvent) {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    create.mutate({ title });
    setDraft('');
  }

  function toggle(task: TaskNode) {
    if (task.completedAt === null) complete.mutate(task.id);
    else uncomplete.mutate(task.id);
  }

  function patchFilter(part: Partial<TaskFilterValue>) {
    setFilter((current) => {
      const next = { ...current, ...part };
      // Drop empty values so they never reach the query string.
      for (const key of Object.keys(next) as (keyof TaskFilterValue)[]) {
        if (!next[key]) delete next[key];
      }
      return next;
    });
  }

  return (
    <section>
      <h1 className="screen__title">Active</h1>

      <form className="composer" onSubmit={addTask}>
        <label htmlFor="new-task">Add a task</label>
        <input
          id="new-task"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What needs doing?"
        />
      </form>

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

        <span className="filters__group">
          <label htmlFor="filter-category">Category</label>
          <select
            id="filter-category"
            value={filter.categoryId ?? ''}
            onChange={(e) => patchFilter({ categoryId: e.target.value || undefined })}
          >
            <option value="">Any</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
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

      {tasks.data?.length === 0 && (
        <p className="empty">
          Nothing on the list. Add the first thing above — it stays here until you tick it off, and
          gets filed away overnight.
        </p>
      )}

      {tasks.data && tasks.data.length > 0 && (
        <ul className="tasks">
          {tasks.data.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
              categories={categories.data ?? []}
              onToggle={toggle}
              onDelete={(t) => remove.mutate(t.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
