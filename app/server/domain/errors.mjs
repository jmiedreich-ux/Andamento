export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function validationError(message, details) {
  return new AppError(400, 'VALIDATION_ERROR', message, details);
}

export function notFound(message = 'The requested record was not found.') {
  return new AppError(404, 'NOT_FOUND', message);
}

export function forbidden(message = 'The current actor is not allowed to perform this action.') {
  return new AppError(403, 'FORBIDDEN', message);
}

export function conflict(message, details) {
  return new AppError(409, 'CONFLICT', message, details);
}

export function capabilityUnavailable(message, details) {
  return new AppError(503, 'CAPABILITY_UNAVAILABLE', message, details);
}

export function normalizeError(error) {
  if (error instanceof AppError) return error;
  const message = String(error?.message || error || 'Unexpected application error.');
  if (message.includes('UNIQUE constraint failed')) {
    return conflict('That record already exists.', { cause: message });
  }
  if (message.includes('FOREIGN KEY constraint failed')) {
    return conflict('The requested change conflicts with related saved work.', { cause: message });
  }
  if (message.includes('immutable') || message.includes('append-only')) {
    return conflict(message);
  }
  return new AppError(500, 'INTERNAL_ERROR', 'Andamento could not complete the request.');
}
