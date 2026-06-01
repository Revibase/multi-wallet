/** Linked abort scope: aborts when the parent signal aborts or when `abort()` is called. */
export type AbortScope = {
  signal: AbortSignal;
  abort: (reason?: unknown) => void;
  /** Detach from the parent signal (call when the scope is no longer needed). */
  dispose: () => void;
};

export function linkAbortSignal(parent?: AbortSignal): AbortScope {
  const controller = new AbortController();

  let forwardAbort: (() => void) | undefined;
  if (parent) {
    if (parent.aborted) {
      controller.abort(parent.reason);
    } else {
      forwardAbort = () => controller.abort(parent.reason);
      parent.addEventListener("abort", forwardAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    abort: (reason?: unknown) => {
      if (!controller.signal.aborted) {
        controller.abort(reason);
      }
    },
    dispose: () => {
      if (forwardAbort && parent) {
        parent.removeEventListener("abort", forwardAbort);
      }
    },
  };
}
