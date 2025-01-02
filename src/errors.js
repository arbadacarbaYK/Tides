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

/**
 * @file errors.js
 * @description Custom error handling system for Nostr operations
 * 
 * Features:
 * - Custom NostrError class with error codes
 * - Standardized error handling
 * - Detailed error context preservation
 * - Error logging with context
 * 
 * Usage:
 * throw new NostrError('Failed to decrypt', 'DECRYPT_ERROR', { event });
 * handleError(error, 'Message Processing');
 */