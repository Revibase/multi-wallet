import type {
  ClientAuthorizationCallback,
  SettingsIndexWithAddressArgs,
} from "@revibase/core";
import {
  fetchUserAccountData,
  getWalletAddressFromIndex,
  Secp256r1Key,
  signAndSendBundledTransactions,
  signAndSendTransaction,
} from "@revibase/core";
import type { TransactionSigner } from "gill";
import { buildTransaction } from "src/methods";
import {
  buildTokenTransferInstruction,
  signAndSendTokenTransfer,
} from "src/methods/tokenTransfer";
import { signMessageWithPasskey } from "src/utils";
import { REVIBASE_API_URL, REVIBASE_AUTH_URL } from "src/utils/consts";
import { createSignInMessageText, getRandomPayer } from "src/utils/internal";
import type { Revibase, RevibaseEvent } from "./window";

export function createRevibaseAdapter(
  onClientAuthorizationCallback: ClientAuthorizationCallback,
  feePayer?: TransactionSigner,
  authOrigin?: string
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

  const account = window.localStorage.getItem("Revibase:account");
  const { publicKey, member, settingsIndexWithAddress } = account
    ? (JSON.parse(account) as {
        publicKey: string | null;
        member: string | null;
        settingsIndexWithAddress: SettingsIndexWithAddressArgs | null;
      })
    : { publicKey: null, member: null, settingsIndexWithAddress: null };

  return {
    publicKey,
    member,
    settingsIndexWithAddress,
    connect: async function () {
      const message = createSignInMessageText({
        domain: window.location.origin,
        nonce: crypto.randomUUID(),
      });
      const authResponse = await this.signMessage(message);
      if (!authResponse) {
        throw Error("Failed to verify signed message");
      }
      if (!authResponse.additionalInfo.settingsIndexWithAddress) {
        const userAccountData = await fetchUserAccountData(
          new Secp256r1Key(authResponse.signer)
        );
        if (userAccountData.delegatedTo.__option === "None") {
          throw Error("User has no delegated wallet");
        }
        this.publicKey = (
          await getWalletAddressFromIndex(
            userAccountData.delegatedTo.value.index
          )
        ).toString();
        this.settingsIndexWithAddress = userAccountData.delegatedTo.value;
      } else {
        this.publicKey = await getWalletAddressFromIndex(
          authResponse.additionalInfo.settingsIndexWithAddress.index
        );
        this.settingsIndexWithAddress =
          authResponse.additionalInfo.settingsIndexWithAddress;
      }

      this.member = authResponse.signer;
      window.localStorage.setItem(
        "Revibase:account",
        JSON.stringify(
          {
            publicKey: this.publicKey,
            member: this.member,
            settingsIndexWithAddress: this.settingsIndexWithAddress,
          },
          (key, value) =>
            typeof value === "bigint" ? Number(value.toString()) : value
        )
      );
      emit("connect");
      emit("accountChanged");
    },
    disconnect: async function () {
      this.publicKey = null;
      this.member = null;
      this.settingsIndexWithAddress = null;
      window.localStorage.removeItem("Revibase:account");
      emit("disconnect");
    },
    signMessage: async function (input) {
      return await signMessageWithPasskey({
        signer: this.member ?? undefined,
        onClientAuthorizationCallback,
        message: input,
        authOrigin: authOrigin ?? REVIBASE_AUTH_URL,
      });
    },
    buildTokenTransfer: async function (input) {
      if (!this.member || !this.settingsIndexWithAddress || !this.publicKey) {
        throw new Error("Wallet is not connected");
      }
      const payer = feePayer ?? (await getRandomPayer(REVIBASE_API_URL));
      return buildTokenTransferInstruction({
        signer: this.member,
        payer,
        onClientAuthorizationCallback,
        ...input,
        authOrigin,
      });
    },
    signAndSendTokenTransfer: async function (input) {
      if (!this.member || !this.settingsIndexWithAddress || !this.publicKey) {
        throw new Error("Wallet is not connected");
      }
      const payer = feePayer ?? (await getRandomPayer(REVIBASE_API_URL));
      return signAndSendTokenTransfer({
        signer: this.member,
        onClientAuthorizationCallback,
        payer,
        ...input,
        authOrigin,
      });
    },
    buildTransaction: async function (input) {
      if (!this.member || !this.settingsIndexWithAddress || !this.publicKey) {
        throw new Error("Wallet is not connected");
      }
      const payer = feePayer ?? (await getRandomPayer(REVIBASE_API_URL));
      return buildTransaction({
        signer: this.member,
        settingsIndexWithAddress: this.settingsIndexWithAddress,
        onClientAuthorizationCallback,
        payer,
        ...input,
        authOrigin,
      });
    },
    signAndSendTransaction: async function (input) {
      const transactions = await this.buildTransaction(input);
      if (!transactions.length) {
        throw new Error("Unable to build transaction");
      }
      if (transactions.length === 1) {
        return signAndSendTransaction(transactions[0]);
      } else {
        return signAndSendBundledTransactions(transactions);
      }
    },

    on: function <E extends keyof RevibaseEvent>(
      event: E,
      listener: RevibaseEvent[E],
      context?: any
    ): void {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event]!.push({ fn: listener, ctx: context });
    },
    off: function <E extends keyof RevibaseEvent>(
      event: E,
      listener: RevibaseEvent[E],
      context?: any
    ): void {
      listeners[event] = listeners[event]?.filter(
        (l) => l.fn !== listener || l.ctx !== context
      );
    },
  };
}
