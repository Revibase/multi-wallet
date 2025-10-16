import {
  ReadonlyWalletAccount,
  type StandardConnectInput,
  type WalletAccount,
} from "@wallet-standard/core";
import type {
  AddressesByLookupTableAddress,
  Instruction,
  TransactionSigner,
} from "gill";
import type { MessageAuthenticationResponse } from "../types";

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
  index: number | null;
  connect(input: StandardConnectInput | undefined): Promise<void>;
  disconnect(): Promise<void>;
  signAndSendTransaction(input: {
    instructions: Instruction[];
    addressesByLookupTableAddress?: AddressesByLookupTableAddress;
    additionalSigners?: TransactionSigner[];
    cachedAccounts?: Map<string, any>;
  }): Promise<string>;
  signMessage(input: string): Promise<MessageAuthenticationResponse>;
  verify(input: {
    message: string;
    authResponse: MessageAuthenticationResponse;
  }): Promise<boolean>;
}

export class RevibaseWalletAccount extends ReadonlyWalletAccount {
  readonly member: string | null;
  readonly index: number;

  constructor(account: WalletAccount, member: string | null, index: number) {
    super(account);
    this.member = member;
    this.index = index;
  }
}
