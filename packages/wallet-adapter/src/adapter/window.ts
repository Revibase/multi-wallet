import type { SettingsIndexWithAddress } from "@revibase/core";
import {
  ReadonlyWalletAccount,
  type StandardConnectInput,
  type StandardDisconnectMethod,
  type WalletAccount,
} from "@wallet-standard/core";
import type {
  RevibaseBuildTransactionMethod,
  RevibaseSignAndSendTransactionMethod,
  RevibaseSignMessageMethod,
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
    context?: any
  ): void;
  off<E extends keyof RevibaseEvent>(
    event: E,
    listener: RevibaseEvent[E],
    context?: any
  ): void;
}

export interface Revibase extends RevibaseEventEmitter {
  publicKey: string | null;
  member: string | null;
  settingsIndexWithAddress: SettingsIndexWithAddress | null;
  connect: (input: StandardConnectInput | undefined) => Promise<void>;
  disconnect: StandardDisconnectMethod;
  signAndSendTransaction: RevibaseSignAndSendTransactionMethod;
  buildTransaction: RevibaseBuildTransactionMethod;
  signMessage: RevibaseSignMessageMethod;
}

export class RevibaseWalletAccount extends ReadonlyWalletAccount {
  readonly member: string | null;
  readonly settingsIndexWithAddress: SettingsIndexWithAddress;

  constructor(
    account: WalletAccount,
    member: string | null,
    settingsIndexWithAddress: SettingsIndexWithAddress
  ) {
    super(account);
    this.member = member;
    this.settingsIndexWithAddress = settingsIndexWithAddress;
  }
}
