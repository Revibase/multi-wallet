/**
 * Custom error classes for wallet-adapter operations
 */

export class WalletNotConnectedError extends Error {
  constructor(message = "Wallet is not connected") {
    super(message);
    this.name = "WalletNotConnectedError";
    Object.setPrototypeOf(this, WalletNotConnectedError.prototype);
  }
}

export class WalletConnectionError extends Error {
  constructor(message = "Failed to connect wallet") {
    super(message);
    this.name = "WalletConnectionError";
    Object.setPrototypeOf(this, WalletConnectionError.prototype);
  }
}

export class WalletVerificationError extends Error {
  constructor(message = "Failed to verify signed message") {
    super(message);
    this.name = "WalletVerificationError";
    Object.setPrototypeOf(this, WalletVerificationError.prototype);
  }
}

export class WalletTransactionError extends Error {
  constructor(message = "Transaction failed") {
    super(message);
    this.name = "WalletTransactionError";
    Object.setPrototypeOf(this, WalletTransactionError.prototype);
  }
}

export class WalletStorageError extends Error {
  constructor(message = "Failed to access wallet storage") {
    super(message);
    this.name = "WalletStorageError";
    Object.setPrototypeOf(this, WalletStorageError.prototype);
  }
}

export class WalletProviderError extends Error {
  constructor(message = "Provider error") {
    super(message);
    this.name = "WalletProviderError";
    Object.setPrototypeOf(this, WalletProviderError.prototype);
  }
}
