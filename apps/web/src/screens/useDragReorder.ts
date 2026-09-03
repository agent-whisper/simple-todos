import { useCallback, useState, type DragEvent } from 'react';

/** Props a drop zone spreads onto its element. Absent means "not a target". */
export interface ZoneProps {
  onDragOver: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  'data-over'?: '';
}

/**
 * The browser-facing half of dragging something into a new place: what is in
 * hand, which zone the cursor is over, and the event plumbing both need. What
 * counts as a legal drop, and what a drop does, belong to the caller.
 *
 * Shared rather than written twice. Every drag bug this screen has had lived in
 * exactly these few lines — a press landing on a child rather than the handle,
 * a dragstart bubbling to an ancestor row, a dragleave firing on the way into a
 * child — and a second copy would be a second place to get them wrong.
 *
 * Native HTML5 drag rather than a library: this moves a handful of rows around
 * a list, which is what the platform API is for. It is pointer-only.
 */
export function useDragReorder<T extends { id: string }>(dragImageSelector: string) {
  const [active, setActive] = useState<T | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const source = useCallback(
    (item: T) => ({
      draggable: true,
      onDragStart: (event: DragEvent) => {
        // Handles nest inside draggable-free rows that themselves nest, and
        // dragstart bubbles: without this, grabbing a subtask would start a
        // drag of every ancestor too.
        event.stopPropagation();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.id);
        // Drag the whole row, not the handle — otherwise the thing following
        // the cursor is a few dots and you cannot tell what you picked up.
        const row = (event.currentTarget as HTMLElement).closest(dragImageSelector);
        if (row) event.dataTransfer.setDragImage(row, 16, row.clientHeight / 2);
        setActive(item);
      },
      onDragEnd: () => {
        setActive(null);
        setOverKey(null);
      },
    }),
    [dragImageSelector],
  );

  const zone = useCallback(
    (key: string, allowed: boolean, drop: () => void): ZoneProps | null => {
      if (!allowed) return null;
      return {
        onDragOver: (event) => {
          // preventDefault is what makes an element a drop target at all;
          // stopPropagation keeps the innermost one from lighting up its
          // ancestors as well.
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          setOverKey(key);
        },
        onDragLeave: (event) => {
          // Moving onto a child fires dragleave on the parent. Only a leave
          // that actually exits the zone should unlight it.
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setOverKey((current) => (current === key ? null : current));
        },
        onDrop: (event) => {
          event.preventDefault();
          event.stopPropagation();
          setActive(null);
          setOverKey(null);
          drop();
        },
        ...(overKey === key ? { 'data-over': '' as const } : {}),
      };
    },
    [overKey],
  );

  return { active, source, zone };
}

/**
 * The position an item must take to land in a slot.
 *
 * A slot is an index into the list as displayed, with the dragged item still in
 * it. It is resolved against the position of the item it lands in front of
 * rather than used as a position itself: the two are not the same wherever the
 * screen shows a list that the database does not store contiguously.
 */
export function positionForSlot(siblings: { position: number }[], slot: number): number {
  if (slot < siblings.length) return siblings[slot]!.position;
  const last = siblings[siblings.length - 1];
  return last === undefined ? 0 : last.position + 1;
}

/** True when a slot would put the item back exactly where it already is. */
export function isSameSpot(siblings: { id: string }[], slot: number, id: string): boolean {
  return siblings[slot]?.id === id || siblings[slot - 1]?.id === id;
}
