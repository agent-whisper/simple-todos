import type { CategoryValue } from '@simple-todos/shared';
import { isSameSpot, positionForSlot, useDragReorder, type ZoneProps } from './useDragReorder';

export interface CategoryDrag {
  active: CategoryValue | null;
  source: (category: CategoryValue) => Record<string, unknown>;
  /** `slot` is a gap in the headings as displayed, with the dragged one still in it. */
  zone: (key: string, siblings: CategoryValue[], slot: number) => ZoneProps | null;
}

/**
 * Dragging category headings into order.
 *
 * A flat list, so none of the tree rules that govern task drags apply — a
 * heading cannot land inside itself, and there is no parent to change. All that
 * is refused is a drop that puts it back where it already was.
 */
export function useCategoryDrag(move: (id: string, position: number) => void): CategoryDrag {
  const { active, source, zone } = useDragReorder<CategoryValue>('.group__head');

  return {
    active,
    source,
    zone: (key, siblings, slot) =>
      zone(key, active !== null && !isSameSpot(siblings, slot, active.id), () =>
        move(active!.id, positionForSlot(siblings, slot)),
      ),
  };
}
