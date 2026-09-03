import type { TaskNode } from '@simple-todos/shared';
import { useCallback, useState, type DragEvent } from 'react';

/**
 * A place a dragged task can land: a slot in a list of siblings, as displayed.
 *
 * The slot is carried alongside the list rather than as a bare number because
 * the two do not always agree. Every root task shares one sibling list, but the
 * screen splits that list across category groups, so the third row under a
 * heading is rarely the task with position 3. A slot is resolved against the
 * position of the task it lands in front of, which is right in both lists.
 */
export interface DropTarget {
  parentId: string | null;
  /** The siblings this slot sits among, in display order. */
  siblings: TaskNode[];
  /** 0..siblings.length — the gap before siblings[slot], or the end. */
  slot: number;
  /** Set only for the root list of a category group, which re-files as it moves. */
  categoryId?: string | null;
}

/** The `position` a task must take to land in this slot. */
export function positionFor(target: DropTarget): number {
  const { siblings, slot } = target;
  // Taking the position of the task you are landing in front of works whether
  // the task is moving up or down: the API opens a gap at that position and
  // pushes the rest along.
  if (slot < siblings.length) return siblings[slot]!.position;
  const last = siblings[siblings.length - 1];
  return last === undefined ? 0 : last.position + 1;
}

/** Props a drop zone spreads onto its element. Absent means "not a target". */
export interface ZoneProps {
  onDragOver: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  'data-over'?: '';
}

export interface TaskDrag {
  /** The task under the cursor right now, or null when nothing is being dragged. */
  active: TaskNode | null;
  /** Spread onto a row to make it a drag handle. */
  source: (task: TaskNode) => Record<string, unknown>;
  /** Spread onto a drop zone. Returns null when this target is not legal. */
  zone: (key: string, target: DropTarget) => ZoneProps | null;
}

/** Is `id` this task or anything beneath it? */
function contains(task: TaskNode, id: string): boolean {
  return task.id === id || task.children.some((child) => contains(child, id));
}

function canDrop(dragged: TaskNode, target: DropTarget): boolean {
  // A task cannot become its own parent or its own descendant's child. The API
  // rejects both with a 409; refusing to offer the drop is kinder than letting
  // someone make the gesture and watch it fail.
  if (target.parentId !== null && contains(dragged, target.parentId)) return false;

  if (target.parentId !== dragged.parentId) return true;

  // Same list. A move that only changes the category still counts as a change.
  if (target.categoryId !== undefined && target.categoryId !== dragged.categoryId) return true;

  // The slots either side of where it already sits would put it back.
  const { siblings, slot } = target;
  return siblings[slot]?.id !== dragged.id && siblings[slot - 1]?.id !== dragged.id;
}

/**
 * Drag-and-drop for the active task tree, over the browser's own drag events.
 *
 * Native HTML5 drag rather than a library: this moves a handful of rows around
 * a list, which is what the platform API is for. It is pointer-only, so every
 * move it can make is also reachable from the edit dialog.
 */
export function useTaskDrag(move: (id: string, target: DropTarget) => void): TaskDrag {
  const [active, setActive] = useState<TaskNode | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const source = useCallback(
    (task: TaskNode) => ({
      draggable: true,
      onDragStart: (event: DragEvent) => {
        // Rows nest, and dragstart bubbles: without this, grabbing a subtask
        // would start a drag of every ancestor row too.
        event.stopPropagation();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', task.id);
        setActive(task);
      },
      onDragEnd: () => {
        setActive(null);
        setOverKey(null);
      },
    }),
    [],
  );

  const zone = useCallback(
    (key: string, target: DropTarget): ZoneProps | null => {
      if (!active || !canDrop(active, target)) return null;
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
          move(active.id, target);
        },
        ...(overKey === key ? { 'data-over': '' as const } : {}),
      };
    },
    [active, overKey, move],
  );

  return { active, source, zone };
}
