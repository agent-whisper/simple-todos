import {
  ArchiveResponse,
  Category,
  MeResponse,
  NotesResponse,
  Recurrence,
  RecurrenceHistory,
  Settings,
  type ArchiveGroupByValue,
  type ChangePasswordRequestValue,
  type CreateCategoryRequestValue,
  type CreateRecurrenceRequestValue,
  type UpdateCategoryRequestValue,
  type UpdateRecurrenceRequestValue,
  type UpdateSettingsRequestValue,
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
      void queryClient.invalidateQueries({ queryKey: ['archive'] });
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

export function useArchiveTask() {
  return useTaskMutation((id: string) => apiFetch(`/tasks/${id}/archive`, { method: 'POST' }));
}

export function useDeleteTask() {
  return useTaskMutation((id: string) => apiFetch(`/tasks/${id}`, { method: 'DELETE' }));
}

export function useUpdateTask() {
  return useTaskMutation(({ id, patch }: { id: string; patch: UpdateTaskRequestValue }) =>
    apiFetch(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  );
}

// --- archive ---------------------------------------------------------------

export function useArchive(query: { groupBy: ArchiveGroupByValue; cursor?: string }) {
  const params = new URLSearchParams({ groupBy: query.groupBy });
  if (query.cursor) params.set('cursor', query.cursor);

  return useQuery({
    queryKey: ['archive', query],
    queryFn: () => apiFetch('/archive?' + params.toString(), undefined, ArchiveResponse),
  });
}

// --- recurrences -----------------------------------------------------------

export function useRecurrences() {
  return useQuery({
    queryKey: ['recurrences'],
    queryFn: () => apiFetch('/recurrences', undefined, z.array(Recurrence)),
  });
}

export function useHistory(id: string | null) {
  return useQuery({
    queryKey: ['history', id],
    enabled: id !== null,
    queryFn: () => apiFetch(`/recurrences/${id}/history`, undefined, RecurrenceHistory),
  });
}

function useRecurrenceMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recurrences'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useCreateRecurrence() {
  return useRecurrenceMutation((body: CreateRecurrenceRequestValue) =>
    apiFetch('/recurrences', { method: 'POST', body: JSON.stringify(body) }),
  );
}

export function useUpdateRecurrence() {
  return useRecurrenceMutation(({ id, patch }: { id: string; patch: UpdateRecurrenceRequestValue }) =>
    apiFetch(`/recurrences/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  );
}

export function useDeleteRecurrence() {
  return useRecurrenceMutation((id: string) => apiFetch(`/recurrences/${id}`, { method: 'DELETE' }));
}

// --- notes -----------------------------------------------------------------

export function useNotes(query: { q?: string; status: 'active' | 'archived' | 'all' }) {
  const params = new URLSearchParams({ status: query.status });
  if (query.q) params.set('q', query.q);

  return useQuery({
    queryKey: ['notes', query],
    queryFn: () => apiFetch('/notes?' + params.toString(), undefined, NotesResponse),
  });
}

// --- settings and categories ----------------------------------------------

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateSettingsRequestValue) =>
      apiFetch('/settings', { method: 'PUT', body: JSON.stringify(patch) }, Settings),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: () => apiFetch<{ delivered: boolean }>('/settings/webhook/test', { method: 'POST' }),
  });
}

function useCategoryMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useCreateCategory() {
  return useCategoryMutation((body: CreateCategoryRequestValue) =>
    apiFetch('/categories', { method: 'POST', body: JSON.stringify(body) }),
  );
}

export function useUpdateCategory() {
  return useCategoryMutation(({ id, patch }: { id: string; patch: UpdateCategoryRequestValue }) =>
    apiFetch(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  );
}

export function useDeleteCategory() {
  return useCategoryMutation((id: string) => apiFetch(`/categories/${id}`, { method: 'DELETE' }));
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: ChangePasswordRequestValue) =>
      apiFetch('/auth/password', { method: 'POST', body: JSON.stringify(body) }),
  });
}
