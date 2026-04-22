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

/** Backend authorization failed. */
export class RevibaseAuthError extends RevibaseError {
  constructor(message: string) {
    super(message, "AUTH_FAILED");
    this.name = "RevibaseAuthError";
    Object.setPrototypeOf(this, RevibaseAuthError.prototype);
  }
}
