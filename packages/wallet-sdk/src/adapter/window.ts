import {
  type SolanaSignInInput,
  type SolanaSignInOutput,
} from "@solana/wallet-standard-features";
import { WalletAccount } from "@wallet-standard/base";
import { ReadonlyWalletAccount } from "@wallet-standard/core";
import { SignerPayload } from "../types";

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
  member: SignerPayload | null;
  index: number | null;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<void>;
  disconnect(): void;
  signTransaction(transaction: Uint8Array): Promise<Uint8Array[]>;
  signMessage(
    message: Uint8Array
  ): Promise<{ signature: Uint8Array; signedMessage: Uint8Array }>;
  signIn(input?: SolanaSignInInput): Promise<
    {
      publicKey: string;
      member: SignerPayload;
      index: number;
    } & Omit<SolanaSignInOutput, "account">
  >;
}

export class RevibaseWalletAccount extends ReadonlyWalletAccount {
  readonly member: SignerPayload | null;
  readonly index: number;

  constructor(
    account: WalletAccount,
    member: SignerPayload | null,
    index: number
  ) {
    super(account);
    this.member = member;
    this.index = index;
  }
}

export interface RevibaseSolanaSignInOutput extends SolanaSignInOutput {
  account: RevibaseWalletAccount;
}
