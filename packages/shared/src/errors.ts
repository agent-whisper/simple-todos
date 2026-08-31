import { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL',
] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCodeValue = (typeof ERROR_CODES)[number];

export const ApiErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiErrorBodyValue = z.infer<typeof ApiErrorBody>;
