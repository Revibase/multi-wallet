/** Base error. Use instanceof or .code for handling. */
export class RevibaseError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "RevibaseError";
    this.code = code;
    Object.setPrototypeOf(this, RevibaseError.prototype);
  }
}

/** Auth popup blocked. */
export class RevibasePopupBlockedError extends RevibaseError {
  constructor(message = "Popup blocked. Please enable popups.") {
    super(message, "POPUP_BLOCKED");
    this.name = "RevibasePopupBlockedError";
    Object.setPrototypeOf(this, RevibasePopupBlockedError.prototype);
  }
}

/** User closed popup before auth. */
export class RevibasePopupClosedError extends RevibaseError {
  constructor(message = "Popup was closed by the user") {
    super(message, "POPUP_CLOSED");
    this.name = "RevibasePopupClosedError";
    Object.setPrototypeOf(this, RevibasePopupClosedError.prototype);
  }
}

/** Authorization flow timed out. */
export class RevibaseTimeoutError extends RevibaseError {
  constructor(message = "Authentication timed out") {
    super(message, "TIMEOUT");
    this.name = "RevibaseTimeoutError";
    Object.setPrototypeOf(this, RevibaseTimeoutError.prototype);
  }
}

/** Flow already in progress. */
export class RevibaseFlowInProgressError extends RevibaseError {
  constructor(message = "An authorization flow is already in progress") {
    super(message, "FLOW_IN_PROGRESS");
    this.name = "RevibaseFlowInProgressError";
    Object.setPrototypeOf(this, RevibaseFlowInProgressError.prototype);
  }
}

/** Flow aborted (e.g. AbortSignal). */
export class RevibaseAbortedError extends RevibaseError {
  constructor(message = "Aborted") {
    super(message, "ABORTED");
    this.name = "RevibaseAbortedError";
    Object.setPrototypeOf(this, RevibaseAbortedError.prototype);
  }
}

/** Popup not open. */
export class RevibasePopupNotOpenError extends RevibaseError {
  constructor(message = "Popup is not open. Call startRequest first.") {
    super(message, "POPUP_NOT_OPEN");
    this.name = "RevibasePopupNotOpenError";
    Object.setPrototypeOf(this, RevibasePopupNotOpenError.prototype);
  }
}

/** Backend authorization failed. */
export class RevibaseAuthError extends RevibaseError {
  constructor(message: string) {
    super(message, "AUTH_FAILED");
    this.name = "RevibaseAuthError";
    Object.setPrototypeOf(this, RevibaseAuthError.prototype);
  }
}

/** Used outside browser. */
export class RevibaseEnvironmentError extends RevibaseError {
  constructor(message = "Provider can only be used in a browser environment") {
    super(message, "ENVIRONMENT");
    this.name = "RevibaseEnvironmentError";
    Object.setPrototypeOf(this, RevibaseEnvironmentError.prototype);
  }
}
