export const ErrorCodes = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'CSRF_FAILED',
  'DOMAIN_NOT_VERIFIED',
  'URL_NOT_ALLOWED',
  'QUOTA_EXCEEDED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ErrorCodes)[number];

export const httpStatusForCode: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  CSRF_FAILED: 403,
  DOMAIN_NOT_VERIFIED: 409,
  URL_NOT_ALLOWED: 422,
  QUOTA_EXCEEDED: 429,
  INTERNAL: 500,
};

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return httpStatusForCode[this.code];
  }
}
