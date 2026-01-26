/**
 * Error handling utilities.
 */

/**
 * Safely extract error message from unknown error type.
 * Handles Error objects, strings, and other types.
 * @param error - The caught error
 * @returns Error message string
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
