import {
  Category,
  MeResponse,
  Settings,
  type CreateTaskRequestValue,
  type TaskFilterValue,
  type TaskNode,
  type UpdateTaskRequestValue,
} from '@simple-todos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from './client';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => apiFetch('/auth/me', undefined, MeResponse) });
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => apiFetch('/settings', undefined, Settings) });
}

// --- tasks -----------------------------------------------------------------

export function useTasks(filter: TaskFilterValue = {}) {
  const params = new URLSearchParams();
  if (filter.categoryId) params.set('categoryId', filter.categoryId);
  if (filter.priority) params.set('priority', filter.priority);
  if (filter.q) params.set('q', filter.q);
  const qs = params.toString();

  return useQuery({
    queryKey: ['tasks', filter],
    queryFn: () => apiFetch<TaskNode[]>(`/tasks${qs ? `?${qs}` : ''}`),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch('/categories', undefined, z.array(Category)),
  });
}

/** Every task mutation invalidates the tree, so the list reflects the server. */
function useTaskMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
  });
}

export function useCreateTask() {
  return useTaskMutation((body: CreateTaskRequestValue) =>
    apiFetch('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  );
}

export function useCompleteTask() {
  return useTaskMutation((id: string) => apiFetch(`/tasks/${id}/complete`, { method: 'POST' }));
}

export function useUncompleteTask() {
  return useTaskMutation((id: string) => apiFetch(`/tasks/${id}/uncomplete`, { method: 'POST' }));
}

export function useDeleteTask() {
  return useTaskMutation((id: string) => apiFetch(`/tasks/${id}`, { method: 'DELETE' }));
}

export function useUpdateTask() {
  return useTaskMutation(({ id, patch }: { id: string; patch: UpdateTaskRequestValue }) =>
    apiFetch(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  );
}
