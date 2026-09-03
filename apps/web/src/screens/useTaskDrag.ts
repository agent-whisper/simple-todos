import type { TaskNode } from '@simple-todos/shared';
import { isSameSpot, positionForSlot, useDragReorder, type ZoneProps } from './useDragReorder';

/**
 * A place a dragged task can land.
 *
 * The slot is carried alongside the list rather than as a bare number because
 * the two do not always agree. Every root task shares one sibling list, but the
 * screen splits that list across category groups, so the third row under a
 * heading is rarely the task with position 3.
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

export interface TaskDrag {
  /** The task in hand right now, or null when nothing is being dragged. */
  active: TaskNode | null;
  /** Spread onto a handle to make it a drag source. */
  source: (task: TaskNode) => Record<string, unknown>;
  /** Spread onto a drop zone. Returns null when this target is not legal. */
  zone: (key: string, target: DropTarget) => ZoneProps | null;
}

/** The `position` a task must take to land in this slot. */
export function positionFor(target: DropTarget): number {
  return positionForSlot(target.siblings, target.slot);
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

  return !isSameSpot(target.siblings, target.slot, dragged.id);
}

/** Drag-and-drop for the active task tree. */
export function useTaskDrag(move: (id: string, target: DropTarget) => void): TaskDrag {
  const { active, source, zone } = useDragReorder<TaskNode>('.task');

  return {
    active,
    source,
    zone: (key, target) =>
      zone(key, active !== null && canDrop(active, target), () => move(active!.id, target)),
  };
}
