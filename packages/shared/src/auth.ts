import { z } from 'zod';

export const LoginRequest = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequestValue = z.infer<typeof LoginRequest>;

export const LoginResponse = z.object({
  token: z.string(),
  expiresAt: z.string(),
});
export type LoginResponseValue = z.infer<typeof LoginResponse>;

export const MeResponse = z.object({
  username: z.string(),
  timezone: z.string(),
});
export type MeResponseValue = z.infer<typeof MeResponse>;

export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'new password must be at least 8 characters'),
});
export type ChangePasswordRequestValue = z.infer<typeof ChangePasswordRequest>;
