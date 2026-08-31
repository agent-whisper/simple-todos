import { describe, expect, it } from 'vitest';
import { buildTree, type TaskRow } from './tree.js';

function row(id: string, parentId: string | null, position: number): TaskRow {
  return {
    id,
    parentId,
    rootId: parentId ? 'root' : id,
    position,
    title: id,
    notes: null,
    notesUpdatedAt: null,
    priority: 'should',
    categoryId: null,
    dueDate: null,
    createdAt: '2026-08-31T00:00:00.000Z',
    completedAt: null,
    archivedAt: null,
    recurrenceId: null,
    occurrenceDate: null,
  };
}

describe('buildTree', () => {
  it('returns roots with their children nested', () => {
    const tree = buildTree([row('root', null, 0), row('a', 'root', 0), row('b', 'root', 1)]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe('root');
    expect(tree[0]!.children.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('nests to arbitrary depth', () => {
    const tree = buildTree([row('root', null, 0), row('a', 'root', 0), row('a1', 'a', 0)]);
    expect(tree[0]!.children[0]!.children[0]!.id).toBe('a1');
  });

  it('orders siblings by position, not by input order', () => {
    const tree = buildTree([row('root', null, 0), row('b', 'root', 5), row('a', 'root', 1)]);
    expect(tree[0]!.children.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('orders roots by position too', () => {
    const tree = buildTree([row('second', null, 1), row('first', null, 0)]);
    expect(tree.map((t) => t.id)).toEqual(['first', 'second']);
  });

  it('promotes a child whose parent is absent from the row set to a root', () => {
    // Filtered queries can return a child without its parent; it must not vanish.
    const tree = buildTree([row('orphan', 'missing', 0)]);
    expect(tree.map((t) => t.id)).toEqual(['orphan']);
  });

  it('returns an empty array for no rows', () => {
    expect(buildTree([])).toEqual([]);
  });
});
