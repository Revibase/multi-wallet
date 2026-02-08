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

const DEFAULT_RETRY_CONFIG: Required<
  Omit<RetryConfig, "shouldRetry" | "retryOnRateLimit">
> & { retryOnRateLimit: boolean } = {
  backoffBase: EXPONENTIAL_BACKOFF_BASE,
  maxDelayMs: BACKOFF_MAX_DELAY_MS,
  retryOnRateLimit: true,
  initialDelayMs: DEFAULT_NETWORK_RETRY_DELAY_MS,
  maxRetries: DEFAULT_NETWORK_RETRY_MAX_RETRIES,
};

function isRateLimitStatus(status: number): boolean {
  return status === HTTP_STATUS_TOO_MANY_REQUESTS;
}

function isServerErrorStatus(status: number): boolean {
  return status >= HTTP_STATUS_INTERNAL_SERVER_ERROR;
}

function isClientErrorStatus(status: number): boolean {
  return (
    status >= HTTP_STATUS_BAD_REQUEST &&
    status < HTTP_STATUS_INTERNAL_SERVER_ERROR
  );
}

function isRetryableHttpStatus(status: number): boolean {
  return isRateLimitStatus(status) || isServerErrorStatus(status);
}

function defaultFetchShouldRetry(
  error: unknown,
  _attempt: number,
  config: RetryConfig
): boolean {
  if (error instanceof Response) {
    if (isRateLimitStatus(error.status)) {
      return config.retryOnRateLimit ?? true;
    }
    if (isClientErrorStatus(error.status)) {
      return false;
    }
    return isServerErrorStatus(error.status);
  }
  return error instanceof TypeError || error instanceof Error;
}

export function calculateBackoffDelay(
  attempt: number,
  initialDelayMs: number,
  backoffBase: number,
  maxDelayMs: number
): number {
  const delay = initialDelayMs * Math.pow(backoffBase, attempt - 1);
  return Math.min(delay, maxDelayMs);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config?: RetryConfig
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
        maxDelayMs
      );
      await sleep(delay);
    }
  }

  throw new RetryExhaustedError(
    fn.name || "retryWithBackoff",
    maxRetries,
    lastError
  );
}

export async function retryFetch(
  fetchFn: () => Promise<Response>,
  config?: RetryConfig
): Promise<Response> {
  const mergedConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  const shouldRetry = (error: unknown, attempt: number): boolean =>
    defaultFetchShouldRetry(error, attempt, mergedConfig);

  const fetchAndThrowIfRetryable = async (): Promise<Response> => {
    const response = await fetchFn();
    if (!response.ok && isRetryableHttpStatus(response.status)) {
      throw response;
    }
    return response;
  };

  return retryWithBackoff(fetchAndThrowIfRetryable, {
    ...mergedConfig,
    shouldRetry: config?.shouldRetry ?? shouldRetry,
  });
}

export function createShouldRetryForErrors(
  ...errorClasses: ReadonlyArray<new (...args: any[]) => unknown>
): (error: unknown, _attempt: number) => boolean {
  return (error: unknown): boolean =>
    errorClasses.some(
      (C) => error instanceof (C as new (...args: any[]) => Error)
    );
}
