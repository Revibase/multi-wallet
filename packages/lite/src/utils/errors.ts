/**
 * Base error for Revibase SDK. Use `instanceof` or `code` for programmatic handling.
 */
export class RevibaseError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "RevibaseError";
    this.code = code;
    Object.setPrototypeOf(this, RevibaseError.prototype);
  }
}

/** Thrown when the auth popup was blocked by the browser. */
export class RevibasePopupBlockedError extends RevibaseError {
  constructor(message = "Popup blocked. Please enable popups.") {
    super(message, "POPUP_BLOCKED");
    this.name = "RevibasePopupBlockedError";
    Object.setPrototypeOf(this, RevibasePopupBlockedError.prototype);
  }
}

/** Thrown when the user closed the popup before completing auth. */
export class RevibasePopupClosedError extends RevibaseError {
  constructor(message = "Popup was closed by the user") {
    super(message, "POPUP_CLOSED");
    this.name = "RevibasePopupClosedError";
    Object.setPrototypeOf(this, RevibasePopupClosedError.prototype);
  }
}

/** Thrown when an authorization flow times out. */
export class RevibaseTimeoutError extends RevibaseError {
  constructor(message = "Authentication timed out") {
    super(message, "TIMEOUT");
    this.name = "RevibaseTimeoutError";
    Object.setPrototypeOf(this, RevibaseTimeoutError.prototype);
  }
}

/** Thrown when a new flow is started while one is already in progress. */
export class RevibaseFlowInProgressError extends RevibaseError {
  constructor(message = "An authorization flow is already in progress") {
    super(message, "FLOW_IN_PROGRESS");
    this.name = "RevibaseFlowInProgressError";
    Object.setPrototypeOf(this, RevibaseFlowInProgressError.prototype);
  }
}

/** Thrown when the flow is aborted (e.g. via AbortSignal). */
export class RevibaseAbortedError extends RevibaseError {
  constructor(message = "Aborted") {
    super(message, "ABORTED");
    this.name = "RevibaseAbortedError";
    Object.setPrototypeOf(this, RevibaseAbortedError.prototype);
  }
}

/** Thrown when the popup is not open (e.g. closed before sendPayloadToProviderViaPopup). */
export class RevibasePopupNotOpenError extends RevibaseError {
  constructor(message = "Popup is not open. Call startRequest first.") {
    super(message, "POPUP_NOT_OPEN");
    this.name = "RevibasePopupNotOpenError";
    Object.setPrototypeOf(this, RevibasePopupNotOpenError.prototype);
  }
}

/** Thrown when the backend authorization callback fails. */
export class RevibaseAuthError extends RevibaseError {
  /** @param message - Error message (e.g. from backend response). */
  constructor(message: string) {
    super(message, "AUTH_FAILED");
    this.name = "RevibaseAuthError";
    Object.setPrototypeOf(this, RevibaseAuthError.prototype);
  }
}

/** Thrown when the provider is used outside a browser. */
export class RevibaseEnvironmentError extends RevibaseError {
  constructor(message = "Provider can only be used in a browser environment") {
    super(message, "ENVIRONMENT");
    this.name = "RevibaseEnvironmentError";
    Object.setPrototypeOf(this, RevibaseEnvironmentError.prototype);
  }
}
