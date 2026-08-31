import type { TaskNode, TaskValue } from '@simple-todos/shared';

export type TaskRow = TaskValue;

/**
 * Nest a flat row set into trees, ordering siblings by position.
 *
 * A row whose parent is missing from the set becomes a root. Filtered queries
 * legitimately return a child without its parent, and silently dropping it
 * would make matches disappear.
 */
export function buildTree(rows: TaskRow[]): TaskNode[] {
  const nodes = new Map<string, TaskNode>();
  for (const row of rows) {
    nodes.set(row.id, { ...row, children: [] });
  }

  const roots: TaskNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const byPosition = (a: TaskNode, b: TaskNode) => a.position - b.position;
  roots.sort(byPosition);
  for (const node of nodes.values()) node.children.sort(byPosition);

  return roots;
}
