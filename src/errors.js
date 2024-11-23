export class NostrError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'NostrError';
    this.code = code;
    this.details = details;
  }
}

export function handleError(error, context) {
  if (error instanceof NostrError) {
    console.error(`${context} error:`, error.message, error.details);
    return error;
  }
  
  console.error(`Unexpected ${context} error:`, error);
  return new NostrError(
    'An unexpected error occurred',
    'UNKNOWN_ERROR',
    { originalError: error }
  );
} 