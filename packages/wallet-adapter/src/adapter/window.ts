import {
  ReadonlyWalletAccount,
  type StandardConnectInput,
  type StandardDisconnectMethod,
  type WalletAccount,
} from "@wallet-standard/core";
import type { User } from "src/utils";
import type {
  RevibaseBuildTokenTransferTransactionMethod,
  RevibaseBuildTransactionMethod,
  RevibaseSignAndSendTokenTransferMethod,
  RevibaseSignAndSendTransactionMethod,
} from "./features";

export interface RevibaseEvent {
  connect(...args: unknown[]): unknown;
  disconnect(...args: unknown[]): unknown;
  accountChanged(...args: unknown[]): unknown;
}

export interface RevibaseEventEmitter {
  on<E extends keyof RevibaseEvent>(
    event: E,
    listener: RevibaseEvent[E],
    context?: any,
  ): void;
  off<E extends keyof RevibaseEvent>(
    event: E,
    listener: RevibaseEvent[E],
    context?: any,
  ): void;
}

export interface Revibase extends RevibaseEventEmitter {
  publicKey: string | null;
  user: User | null;
  connect: (input: StandardConnectInput | undefined) => Promise<void>;
  disconnect: StandardDisconnectMethod;
  signAndSendTransaction: RevibaseSignAndSendTransactionMethod;
  buildTransaction: RevibaseBuildTransactionMethod;
  signAndSendTokenTransfer: RevibaseSignAndSendTokenTransferMethod;
  buildTokenTransfer: RevibaseBuildTokenTransferTransactionMethod;
}

export class RevibaseWalletAccount extends ReadonlyWalletAccount {
  readonly user: User | null;

  constructor(account: WalletAccount, user: User | null) {
    super(account);
    this.user = user;
  }
}
