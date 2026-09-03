import type { TaskNode, UpdateTaskRequestValue } from '@simple-todos/shared';
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
import { useCollapsed } from './useCollapsed';
import './screens.css';

/**
 * What you have in hand right now.
 *
 * The API returns each flagged task with the trail of parents above it, so a
 * step deep in a project arrives with the project it belongs to rather than as
 * a title with no context. Those parents are not themselves flagged — the badge
 * on the row is what says which one you meant.
 *
 * No grouping and no dragging: this is a short list you are meant to work
 * through, not a place to organise. Ordering belongs to the Active screen.
 */
export function FocusScreen() {
  const [dialog, setDialog] = useState<TaskDialogTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TaskNode | null>(null);
  const [pendingArchive, setPendingArchive] = useState<TaskNode | null>(null);
  const fold = useCollapsed('simple-todos.collapsed.focus');

  const settings = useSettings();
  const tasks = useTasks({ workingOn: true });
  const categories = useCategories();
  const create = useCreateTask();
  const complete = useCompleteTask();
  const uncomplete = useUncompleteTask();
  const remove = useDeleteTask();
  const update = useUpdateTask();
  const archive = useArchiveTask();

  const timeZone = settings.data?.timezone ?? 'UTC';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

  function toggle(task: TaskNode) {
    if (task.completedAt === null) complete.mutate(task.id);
    else uncomplete.mutate(task.id);
  }

  return (
    <section>
      <h1 className="screen__title">Working on</h1>

      {tasks.isPending && <p className="muted">Loading…</p>}

      {tasks.isError && (
        <p role="alert" className="error">
          The list could not be loaded. Check the server is running.
        </p>
      )}

      {tasks.data?.length === 0 && (
        <p className="empty">
          Nothing in hand. Mark a task on the Active screen and it will wait for you here, with
          whatever it hangs off for context.
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
              onDelete={setPendingDelete}
              onArchive={setPendingArchive}
              onAddSubtask={(t) =>
                setDialog({ mode: 'add', label: t.title, parentId: t.id, priority: t.priority })
              }
              onEdit={(t) => setDialog({ mode: 'edit', task: t })}
              onWorkingOn={(t, working) => update.mutate({ id: t.id, patch: { workingOn: working } })}
              isCollapsed={fold.isCollapsed}
              onToggleCollapsed={fold.toggle}
            />
          ))}
        </ul>
      )}

      {pendingArchive && (
        <ConfirmDialog
          heading={`Archive ${pendingArchive.title}?`}
          body="The whole tree goes with it, and anything unfinished is marked done. You can find it again on the Archive screen."
          confirmLabel="Archive"
          onConfirm={() => archive.mutate(pendingArchive.id, { onSuccess: () => setPendingArchive(null) })}
          onCancel={() => setPendingArchive(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          heading={`Delete ${pendingDelete.title}?`}
          body="Its subtasks go with it. This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => remove.mutate(pendingDelete.id, { onSuccess: () => setPendingDelete(null) })}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {dialog && (
        <TaskDialog
          target={dialog}
          categories={categories.data ?? []}
          onClose={() => setDialog(null)}
          onAdd={(input) => create.mutate(input, { onSuccess: () => setDialog(null) })}
          onEdit={(id: string, patch: UpdateTaskRequestValue) =>
            update.mutate({ id, patch }, { onSuccess: () => setDialog(null) })
          }
        />
      )}
    </section>
  );
}
