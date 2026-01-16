/**
 * Custom error classes for the SDK
 * Provides better error handling and debugging capabilities
 */

/**
 * Base error class for all SDK errors
 */
export class RevibaseError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when SDK is not properly initialized
 */
export class NotInitializedError extends RevibaseError {
  constructor(service: string) {
    super(
      `${service} is not initialized. Please call initialize() first.`,
      "NOT_INITIALIZED"
    );
  }
}

/**
 * Error thrown when a required account or data is not found
 */
export class NotFoundError extends RevibaseError {
  constructor(resource: string, details?: string) {
    super(
      `${resource} not found.${details ? ` ${details}` : ""}`,
      "NOT_FOUND"
    );
  }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends RevibaseError {
  constructor(message: string, field?: string) {
    super(message, "VALIDATION_ERROR", { field });
  }
}

/**
 * Error thrown when a network request fails
 */
export class NetworkError extends RevibaseError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly url?: string
  ) {
    super(message, "NETWORK_ERROR", { statusCode, url });
  }
}

/**
 * Error thrown when a transaction fails
 */
export class TransactionError extends RevibaseError {
  constructor(
    message: string,
    public readonly signature?: string,
    public readonly logs?: string[]
  ) {
    super(message, "TRANSACTION_ERROR", { signature, logs });
  }
}

/**
 * Error thrown when bundle operations fail
 */
export class BundleError extends RevibaseError {
  constructor(
    message: string,
    public readonly bundleId?: string,
    public readonly attempt?: number
  ) {
    super(message, "BUNDLE_ERROR", { bundleId, attempt });
  }
}

/**
 * Error thrown when retry operations exhaust all attempts
 */
export class RetryExhaustedError extends RevibaseError {
  constructor(
    operation: string,
    public readonly attempts: number,
    public readonly lastError?: unknown
  ) {
    super(
      `Operation "${operation}" failed after ${attempts} attempts.`,
      "RETRY_EXHAUSTED",
      { lastError }
    );
  }
}

/**
 * Error thrown when permissions are insufficient
 */
export class PermissionError extends RevibaseError {
  constructor(
    message: string,
    public readonly required?: string[],
    public readonly actual?: string[]
  ) {
    super(message, "PERMISSION_ERROR", { required, actual });
  }
}
