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

export interface RetryConfig {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffBase?: number;
  maxDelayMs?: number;
  retryOnRateLimit?: boolean;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

const DEFAULT_RETRY_CONFIG = {
  backoffBase: EXPONENTIAL_BACKOFF_BASE,
  maxDelayMs: BACKOFF_MAX_DELAY_MS,
  retryOnRateLimit: true,
  initialDelayMs: DEFAULT_NETWORK_RETRY_DELAY_MS,
  maxRetries: DEFAULT_NETWORK_RETRY_MAX_RETRIES,
};

export function calculateBackoffDelay(
  attempt: number,
  initialDelayMs: number,
  backoffBase: number,
  maxDelayMs: number,
): number {
  const delay = initialDelayMs * Math.pow(backoffBase, attempt - 1);
  return Math.min(delay, maxDelayMs);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

      if (shouldRetry && !shouldRetry(error, attempt)) {
        throw error;
      }

      if (attempt >= maxRetries) {
        break;
      }

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

export async function retryFetch(
  fetchFn: () => Promise<Response>,
  config?: RetryConfig,
): Promise<Response> {
  const shouldRetry = (error: unknown, attempt: number): boolean => {
    if (attempt > (config?.maxRetries ?? DEFAULT_NETWORK_RETRY_MAX_RETRIES)) {
      return false;
    }
    if (error instanceof Response) {
      if (error.status === HTTP_STATUS_TOO_MANY_REQUESTS) {
        return config?.retryOnRateLimit ?? true;
      }
      if (
        error.status >= HTTP_STATUS_BAD_REQUEST &&
        error.status < HTTP_STATUS_INTERNAL_SERVER_ERROR
      ) {
        return false;
      }
      return error.status >= HTTP_STATUS_INTERNAL_SERVER_ERROR;
    }
    return error instanceof TypeError || error instanceof Error;
  };

  return retryWithBackoff(fetchFn, {
    ...config,
    shouldRetry: config?.shouldRetry ?? shouldRetry,
  });
}
