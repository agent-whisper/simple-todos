import type { TaskNode } from '@simple-todos/shared';
import { useState } from 'react';

/** Ids whose own title or notes contain the query — the same test the API runs. */
function matchIds(roots: TaskNode[], q: string): Set<string> {
  const needle = q.toLowerCase();
  const found = new Set<string>();
  const walk = (nodes: TaskNode[]) => {
    for (const node of nodes) {
      if (`${node.title} ${node.notes ?? ''}`.toLowerCase().includes(needle)) found.add(node.id);
      walk(node.children);
    }
  };
  walk(roots);
  return found;
}

/**
 * Fold state for a search result.
 *
 * A search returns each hit with its whole subtree and the trail of parents
 * above it. Showing all of that expanded buries the hits in their own
 * children, so a hit starts folded: you see the trail down to it, and open it
 * when you want what is inside. The parents on the trail stay open, because
 * they are the path to the thing you were looking for.
 *
 * Deliberately not persisted, and reset whenever the query changes — this is a
 * property of one search, not of the tree.
 */
export function useSearchFold(q: string, roots: TaskNode[]) {
  const [state, setState] = useState<{ q: string; overrides: Record<string, boolean> }>({
    q,
    overrides: {},
  });

  const matches = matchIds(roots, q);
  const overrides = state.q === q ? state.overrides : {};

  return {
    isCollapsed: (id: string) => overrides[id] ?? matches.has(id),
    toggle: (id: string) =>
      setState((current) => {
        const prior = current.q === q ? current.overrides : {};
        return { q, overrides: { ...prior, [id]: !(prior[id] ?? matches.has(id)) } };
      }),
  };
}
