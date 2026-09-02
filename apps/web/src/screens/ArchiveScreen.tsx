import type { ArchiveGroupByValue, TaskNode, TaskValue } from '@simple-todos/shared';
import { useState } from 'react';
import { useArchive } from '../api/hooks';
import './screens.css';

const GROUPINGS: { value: ArchiveGroupByValue; label: string }[] = [
  { value: 'parent', label: 'Parent task' },
  { value: 'added', label: 'Added date' },
  { value: 'completed', label: 'Completed date' },
];

function ArchivedTree({ node, depth = 0 }: { node: TaskNode; depth?: number }) {
  return (
    <li>
      <div className="archived" style={{ paddingLeft: `calc(var(--space-4) * ${depth})` }}>
        <span className="archived__title">{node.title}</span>
        <span className="archived__dates data">
          added {node.createdAt.slice(0, 10)} · done {node.completedAt?.slice(0, 10) ?? '—'}
        </span>
      </div>
      {node.children.length > 0 && (
        <ul className="archived__children">
          {node.children.map((c) => (
            <ArchivedTree key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ArchivedRow({ task }: { task: TaskValue }) {
  return (
    <li className="archived">
      <span className="archived__title">{task.title}</span>
      <span className="archived__dates data">
        added {task.createdAt.slice(0, 10)} · done {task.completedAt?.slice(0, 10) ?? '—'}
      </span>
    </li>
  );
}

export function ArchiveScreen() {
  const [groupBy, setGroupBy] = useState<ArchiveGroupByValue>('parent');
  const archive = useArchive({ groupBy });

  return (
    <section>
      <h1 className="screen__title">Archive</h1>

      <div className="filters">
        <span className="filters__group">
          <label htmlFor="group-by">Group by</label>
          <select
            id="group-by"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as ArchiveGroupByValue)}
          >
            {GROUPINGS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </span>
      </div>

      {archive.isPending && <p className="muted">Loading…</p>}

      {archive.data?.groups.length === 0 && (
        <p className="empty">
          Nothing has been filed away yet. Finished tasks stay on the Active list until the nightly
          sweep moves them here, and only once every task in a tree is done.
        </p>
      )}

      {archive.data?.groupBy === 'parent' &&
        archive.data.groups.map((group) => (
          <section key={group.rootId} className="group">
            <h2 className="group__heading data">{group.latestCompletedAt.slice(0, 10)}</h2>
            <ul className="archived__list">
              <ArchivedTree node={group.tree} />
            </ul>
          </section>
        ))}

      {archive.data && archive.data.groupBy !== 'parent' &&
        archive.data.groups.map((group) => (
          <section key={group.date} className="group">
            <h2 className="group__heading">{group.date}</h2>
            <ul className="archived__list">
              {group.tasks.map((task) => (
                <ArchivedRow key={task.id} task={task} />
              ))}
            </ul>
          </section>
        ))}
    </section>
  );
}
