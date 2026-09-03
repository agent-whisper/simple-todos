import { useCallback, useState } from 'react';

/**
 * A remembered set of collapsed things, keyed by id.
 *
 * Persisted because collapse state that resets on every navigation is more
 * annoying than no collapse at all — you tidy the screen, glance at the
 * Archive, come back, and it has all sprung open again.
 *
 * Every storage access is wrapped: a private-mode browser can throw on access
 * rather than returning null, and losing the ability to fold a list is not
 * worth taking the screen down for.
 */
export interface Fold {
  isCollapsed(id: string): boolean;
  toggle(id: string): void;
  collapseAll(ids: string[]): void;
  expandAll(ids: string[]): void;
}

export function useCollapsed(storageKey: string): Fold {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return new Set();
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set();
    } catch {
      return new Set();
    }
  });

  const write = useCallback(
    (change: (next: Set<string>) => void) => {
      setCollapsed((current) => {
        const next = new Set(current);
        change(next);
        try {
          localStorage.setItem(storageKey, JSON.stringify([...next]));
        } catch {
          // The fold simply lasts only as long as this page.
        }
        return next;
      });
    },
    [storageKey],
  );

  const toggle = useCallback(
    (id: string) => write((next) => (next.has(id) ? next.delete(id) : next.add(id))),
    [write],
  );

  const collapseAll = useCallback(
    (ids: string[]) => write((next) => ids.forEach((id) => next.add(id))),
    [write],
  );

  const expandAll = useCallback(
    (ids: string[]) => write((next) => ids.forEach((id) => next.delete(id))),
    [write],
  );

  const isCollapsed = useCallback((id: string) => collapsed.has(id), [collapsed]);

  return { isCollapsed, toggle, collapseAll, expandAll };
}
