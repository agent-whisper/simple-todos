import type { ErrorCodeValue } from '@simple-todos/shared';

/** Errors the API deliberately surfaces. Anything else becomes a 500. */
export abstract class AppError extends Error {
  abstract readonly code: ErrorCodeValue;
  abstract readonly status: number;
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND' as const;
  readonly status = 404;

  constructor(resource: string, id: string) {
    super(`${resource} ${id} not found`);
  }
}

export class ConflictError extends AppError {
  readonly code = 'CONFLICT' as const;
  readonly status = 409;
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR' as const;
  readonly status = 400;
}

export class UnauthenticatedError extends AppError {
  readonly code = 'UNAUTHENTICATED' as const;
  readonly status = 401;

  constructor(message = 'authentication required') {
    super(message);
  }
}
