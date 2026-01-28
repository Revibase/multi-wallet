/**
 * Retry utility functions with exponential backoff
 * Provides consistent retry logic across the SDK
 */

import {
  BACKOFF_MAX_DELAY_MS,
  DEFAULT_NETWORK_RETRY_DELAY_MS,
  DEFAULT_NETWORK_RETRY_MAX_RETRIES,
  EXPONENTIAL_BACKOFF_BASE,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_TOO_MANY_REQUESTS,
} from "../constants";
import { RetryExhaustedError } from "../errors";

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Initial delay in milliseconds */
  initialDelayMs?: number;
  /** Base for exponential backoff (default: 2) */
  backoffBase?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Whether to retry on 429 (rate limit) errors */
  retryOnRateLimit?: boolean;
  /** Custom function to determine if an error should be retried */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG = {
  backoffBase: EXPONENTIAL_BACKOFF_BASE,
  maxDelayMs: BACKOFF_MAX_DELAY_MS,
  retryOnRateLimit: true,
  initialDelayMs: DEFAULT_NETWORK_RETRY_DELAY_MS,
  maxRetries: DEFAULT_NETWORK_RETRY_MAX_RETRIES,
};

/**
 * Calculates the delay for a given attempt using exponential backoff
 * @param attempt - Current attempt number (1-indexed)
 * @param initialDelayMs - Initial delay in milliseconds
 * @param backoffBase - Base for exponential backoff
 * @param maxDelayMs - Maximum delay in milliseconds
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  initialDelayMs: number,
  backoffBase: number,
  maxDelayMs: number,
): number {
  const delay = initialDelayMs * Math.pow(backoffBase, attempt - 1);
  return Math.min(delay, maxDelayMs);
}

/**
 * Sleeps for the specified number of milliseconds
 * @param ms - Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries an async function with exponential backoff
 * @param fn - Async function to retry
 * @param config - Retry configuration
 * @returns Result of the function
 * @throws {RetryExhaustedError} If all retries are exhausted
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config?: RetryConfig,
): Promise<T> {
  const { maxRetries, initialDelayMs, backoffBase, maxDelayMs, shouldRetry } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (shouldRetry && !shouldRetry(error, attempt)) {
        throw error;
      }

      // Don't retry on the last attempt
      if (attempt >= maxRetries) {
        break;
      }

      // Calculate and apply delay
      const delay = calculateBackoffDelay(
        attempt,
        initialDelayMs,
        backoffBase,
        maxDelayMs,
      );
      await sleep(delay);
    }
  }

  throw new RetryExhaustedError(
    fn.name || "retryWithBackoff",
    maxRetries,
    lastError,
  );
}

/**
 * Retries a fetch request with exponential backoff
 * Handles rate limiting (429) and network errors automatically
 * @param fetchFn - Function that returns a fetch Promise
 * @param config - Retry configuration
 * @returns Fetch response
 * @throws {RetryExhaustedError} If all retries are exhausted
 */
export async function retryFetch(
  fetchFn: () => Promise<Response>,
  config?: RetryConfig,
): Promise<Response> {
  const shouldRetry = (error: unknown, attempt: number): boolean => {
    if (attempt > (config?.maxRetries ?? DEFAULT_NETWORK_RETRY_MAX_RETRIES)) {
      return false;
    }
    // If it's a Response object, check status
    if (error instanceof Response) {
      if (error.status === HTTP_STATUS_TOO_MANY_REQUESTS) {
        return config?.retryOnRateLimit ?? true;
      }
      // Don't retry client errors (4xx) except 429
      if (
        error.status >= HTTP_STATUS_BAD_REQUEST &&
        error.status < HTTP_STATUS_INTERNAL_SERVER_ERROR
      ) {
        return false;
      }
      // Retry server errors (5xx) and network errors
      return error.status >= HTTP_STATUS_INTERNAL_SERVER_ERROR;
    }

    // Retry on network errors (TypeError, etc.)
    return error instanceof TypeError || error instanceof Error;
  };

  return retryWithBackoff(fetchFn, {
    ...config,
    shouldRetry: config?.shouldRetry ?? shouldRetry,
  });
}
