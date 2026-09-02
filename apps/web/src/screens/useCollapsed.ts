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
export function useCollapsed(storageKey: string) {
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

  const toggle = useCallback(
    (id: string) => {
      setCollapsed((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
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

  const isCollapsed = useCallback((id: string) => collapsed.has(id), [collapsed]);

  return { isCollapsed, toggle };
}
