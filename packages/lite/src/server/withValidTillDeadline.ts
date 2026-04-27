/** Merged signal aborts when either input aborts. */
function combineAbortSignals(
  a: AbortSignal | undefined,
  b: AbortSignal | undefined,
): AbortSignal {
  if (!a && !b) {
    const never = new AbortController();
    return never.signal;
  }
  if (!a) return b!;
  if (!b) return a;
  if (a.aborted || b.aborted) {
    const c = new AbortController();
    c.abort();
    return c.signal;
  }
  const merged = new AbortController();
  const abort = (): void => merged.abort();
  a.addEventListener("abort", abort, { once: true });
  b.addEventListener("abort", abort, { once: true });
  return merged.signal;
}

const EXPIRED_MESSAGE = "Authorization request expired (exceeded validTill)";

/**
 * Runs `fn` with a combined AbortSignal that aborts at `validTill`, so in-flight
 * fetches do not hang past the server deadline.
 */
export async function withValidTillDeadline<T>(
  validTill: number,
  callerSignal: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (Date.now() > validTill) {
    throw new Error(EXPIRED_MESSAGE);
  }

  const deadlineController = new AbortController();
  const ms = Math.max(0, validTill - Date.now());
  let deadlineFired = false;
  const timer = setTimeout(() => {
    deadlineFired = true;
    deadlineController.abort();
  }, ms);

  const combined = combineAbortSignals(callerSignal, deadlineController.signal);

  try {
    return await fn(combined);
  } catch (e) {
    if (deadlineFired) {
      throw new Error(EXPIRED_MESSAGE);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
