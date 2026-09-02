import { MeResponse, Settings } from '@simple-todos/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => apiFetch('/auth/me', undefined, MeResponse) });
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => apiFetch('/settings', undefined, Settings) });
}
