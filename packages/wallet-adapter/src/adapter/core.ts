import {
  pollJitoBundleConfirmation,
  signAndSendBundledTransactions,
  signAndSendTransaction,
} from "@revibase/core";
import type { TransactionSigner } from "gill";
import { buildTransaction } from "src/methods";
import {
  buildTokenTransferInstruction,
  signAndSendTokenTransfer,
} from "src/methods/tokenTransfer";
import type { RevibaseProvider } from "src/provider";
import { REVIBASE_API_URL } from "src/utils/consts";
import {
  WalletConnectionError,
  WalletNotConnectedError,
  WalletTransactionError,
  WalletVerificationError,
} from "src/utils/errors";
import { getRandomPayer } from "src/utils/helper";
import { createSignInMessageText } from "src/utils/internal";
import { signAndVerifyMessageWithPasskey } from "src/utils/signAndVerifyMessageWithPasskey";
import {
  getStoredAccount,
  removeStoredAccount,
  setStoredAccount,
} from "src/utils/storage";
import type { Revibase, RevibaseEvent } from "./window";

/**
 * Creates a Revibase wallet adapter instance.
 *
 * The adapter provides methods for connecting, signing messages, and building/sending transactions.
 * It manages wallet state and persists account information to localStorage.
 *
 * @param provider - The Revibase provider instance for handling authentication
 * @param feePayer - Optional transaction signer to use as fee payer. If not provided, a random payer will be fetched.
 * @returns A configured Revibase adapter instance
 *
 * @example
 * ```ts
 * const provider = new RevibaseProvider({ onClientAuthorizationCallback });
 * const adapter = createRevibaseAdapter(provider);
 * await adapter.connect();
 * ```
 */
export function createRevibaseAdapter(
  provider: RevibaseProvider,
  feePayer?: TransactionSigner,
): Revibase {
  // 👇 Event listener map
  const listeners: {
    [E in keyof RevibaseEvent]?: Array<{ fn: RevibaseEvent[E]; ctx?: any }>;
  } = {};

  // 👇 Internal emit function
  function emit<E extends keyof RevibaseEvent>(
    event: E,
    ...args: Parameters<RevibaseEvent[E]>
  ) {
    listeners[event]?.forEach(({ fn, ctx }) => {
      fn.apply(ctx, args);
    });
  }

  // Safely retrieve stored account data
  const storedAccount = getStoredAccount();
  const publicKey = storedAccount?.publicKey ?? null;
  const member = storedAccount?.member ?? null;
  const settingsIndexWithAddress =
    storedAccount?.settingsIndexWithAddress ?? null;

  return {
    publicKey,
    member,
    settingsIndexWithAddress,
    connect: async function () {
      try {
        const message = createSignInMessageText({
          domain: window.location.origin,
          nonce: crypto.randomUUID(),
        });
        const { user } = await signAndVerifyMessageWithPasskey({
          message,
          provider,
        });
        if (!user) {
          throw new WalletVerificationError("Failed to verify signed message");
        }
        this.publicKey = user.walletAddress;
        this.member = user.publicKey;
        this.settingsIndexWithAddress = user.settingsIndexWithAddress;

        // Store account data
        setStoredAccount({
          publicKey: this.publicKey,
          member: this.member,
          settingsIndexWithAddress: this.settingsIndexWithAddress,
        });

        emit("connect");
        emit("accountChanged");
      } catch (error) {
        if (
          error instanceof WalletVerificationError ||
          error instanceof WalletConnectionError
        ) {
          throw error;
        }
        throw new WalletConnectionError(
          `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    disconnect: async function () {
      this.publicKey = null;
      this.member = null;
      this.settingsIndexWithAddress = null;
      removeStoredAccount();
      emit("disconnect");
    },
    buildTokenTransfer: async function (input) {
      if (!this.member || !this.settingsIndexWithAddress || !this.publicKey) {
        throw new WalletNotConnectedError();
      }
      const payer = feePayer ?? (await getRandomPayer(REVIBASE_API_URL));
      return buildTokenTransferInstruction({
        ...input,
        signer: this.member,
        payer,
        provider,
      });
    },
    signAndSendTokenTransfer: async function (input) {
      if (!this.member || !this.settingsIndexWithAddress || !this.publicKey) {
        throw new WalletNotConnectedError();
      }
      const payer = feePayer ?? (await getRandomPayer(REVIBASE_API_URL));
      return signAndSendTokenTransfer({
        ...input,
        signer: this.member,
        payer,
        provider,
      });
    },
    buildTransaction: async function (input) {
      if (!this.member || !this.settingsIndexWithAddress || !this.publicKey) {
        throw new WalletNotConnectedError();
      }
      const payer = feePayer ?? (await getRandomPayer(REVIBASE_API_URL));
      return buildTransaction({
        ...input,
        signer: this.member,
        settingsIndexWithAddress: this.settingsIndexWithAddress,
        payer,
        provider,
      });
    },
    signAndSendTransaction: async function (input) {
      const transactions = await this.buildTransaction(input);
      if (!transactions.length) {
        throw new WalletTransactionError("Unable to build transaction");
      }
      if (transactions.length === 1) {
        return signAndSendTransaction(transactions[0]);
      } else {
        const bundleId = await signAndSendBundledTransactions(transactions);
        return pollJitoBundleConfirmation(bundleId);
      }
    },

    on: function <E extends keyof RevibaseEvent>(
      event: E,
      listener: RevibaseEvent[E],
      context?: any,
    ): void {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event]!.push({ fn: listener, ctx: context });
    },
    off: function <E extends keyof RevibaseEvent>(
      event: E,
      listener: RevibaseEvent[E],
      context?: any,
    ): void {
      listeners[event] = listeners[event]?.filter(
        (l) => l.fn !== listener || l.ctx !== context,
      );
    },
  };
}
