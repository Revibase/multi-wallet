/**
 * Checks if an error is network-related (e.g., load failed, network errors)
 */
function isNetworkError(err: Error): boolean {
  const msg = err?.message || "";
  return (
    msg === "Failed to fetch" ||
    msg.includes("Load failed") ||
    msg.includes("NetworkError") ||
    msg.includes("ERR_NETWORK")
  );
}

/**
 * Retries a function with exponential backoff on network errors only.
 * @param fn - The async function to retry
 * @param maxAttempts - Maximum number of attempts (default: 3)
 * @param initialDelay - Initial delay in ms (default: 100)
 * @param maxDelay - Maximum delay in ms (default: 5000)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  initialDelay = 500,
  maxDelay = 5000,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Only retry on network errors
      if (!isNetworkError(lastError)) {
        throw lastError;
      }

      // Don't retry on the last attempt
      if (attempt === maxAttempts - 1) {
        break;
      }

      // Calculate exponential backoff delay
      const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
