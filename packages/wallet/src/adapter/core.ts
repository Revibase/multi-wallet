import { address } from "gill";
import {
  signMessage as signPasskeyMessage,
  signTransaction as signPasskeyTransaction,
  verifyMessage,
} from "../passkeys";
import {
  prepareTransactionBundle,
  prepareTransactionMessage,
  prepareTransactionSync,
} from "../transaction";
import { Secp256r1Key } from "../types";
import {
  createPopUp,
  fetchSettingsData,
  fetchUserAccountData,
  getFeePayer,
  getSettingsFromIndex,
  getTransactionBufferAddress,
  getWalletAddressFromIndex,
} from "../utils";
import {
  createSignInMessageText,
  estimateJitoTips,
  estimateTransactionSizeExceedLimit,
  sendBundleTransaction,
  sendNonBundleTransaction,
  simulateSecp256r1Signer,
} from "../utils/adapter";
import { resolveTransactionManagerSigner } from "../utils/helper";
import type { Revibase, RevibaseEvent } from "./window";

export function createRevibaseAdapter(): Revibase {
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
  const { publicKey, member, index } = account
    ? (JSON.parse(account) as {
        publicKey: string | null;
        member: string | null;
        index: number | null;
      })
    : { publicKey: null, member: null, index: null };

  return {
    publicKey,
    member,
    index,
    connect: async function () {
      const message = createSignInMessageText({
        domain: window.location.origin,
        nonce: crypto.randomUUID(),
      });
      const authResponse = await this.signMessage(message);
      const verified = await this.verify({ message, authResponse });
      if (!verified) {
        throw Error("Failed to verify signed message");
      }
      if (
        !authResponse.additionalInfo?.walletAddress ||
        !authResponse.additionalInfo.settingsIndex
      ) {
        const userAccountData = await fetchUserAccountData(
          new Secp256r1Key(authResponse.signer)
        );
        if (userAccountData.settingsIndex.__option === "None") {
          throw Error("User has no delegated wallet");
        }
        this.publicKey = (
          await getWalletAddressFromIndex(userAccountData.settingsIndex.value)
        ).toString();
        this.index = Number(userAccountData.settingsIndex.value);
      } else {
        this.publicKey = authResponse.additionalInfo.walletAddress;
        this.index = authResponse.additionalInfo.settingsIndex;
      }

      this.member = authResponse.signer;
      window.localStorage.setItem(
        "Revibase:account",
        JSON.stringify({
          publicKey: this.publicKey,
          member: this.member,
          index: this.index,
        })
      );
      emit("connect");
      emit("accountChanged");
    },
    disconnect: async function () {
      this.publicKey = null;
      this.member = null;
      this.index = null;
      window.localStorage.removeItem("Revibase:account");
      emit("disconnect");
    },
    signMessage: async function (input) {
      const response = await signPasskeyMessage({
        signer: this.member ?? undefined,
        message: input,
      });
      return response;
    },
    verify: async function (input) {
      const verified = await verifyMessage({
        message: input.message,
        response: input.authResponse,
      });
      return verified;
    },
    signAndSendTransaction: async function (input) {
      if (!this.member || !this.index || !this.publicKey) {
        throw new Error(
          "Wallet is not connected or missing member/index/public key."
        );
      }
      // open popup first so that browser won't prompt user for permission
      const popUp = createPopUp();
      let {
        addressesByLookupTableAddress,
        instructions,
        additionalSigners,
        cachedAccounts = new Map(),
      } = input;

      const [settingsData, settings, payer, transactionMessageBytes] =
        await Promise.all([
          fetchSettingsData(this.index, cachedAccounts),
          getSettingsFromIndex(this.index),
          getFeePayer(),
          prepareTransactionMessage({
            payer: address(this.publicKey),
            instructions,
            addressesByLookupTableAddress,
          }),
        ]);

      const transactionManagerSigner = await resolveTransactionManagerSigner({
        member: this.member,
        index: this.index,
        transactionMessageBytes,
        cachedAccounts,
      });

      const useBundle = await estimateTransactionSizeExceedLimit({
        signers: [
          simulateSecp256r1Signer(),
          ...(additionalSigners ?? []),
          ...(transactionManagerSigner ? [transactionManagerSigner] : []),
        ],
        compressed: settingsData.isCompressed,
        payer,
        settingsIndex: this.index,
        transactionMessageBytes,
        addressesByLookupTableAddress,
        cachedAccounts,
      });
      if (useBundle) {
        const bufferIndex = Math.round(Math.random() * 255);
        const transactionBufferAddress = await getTransactionBufferAddress(
          settings,
          transactionManagerSigner
            ? transactionManagerSigner.address
            : new Secp256r1Key(this.member),
          bufferIndex
        );
        const [signedTx, jitoBundlesTipAmount] = await Promise.all([
          signPasskeyTransaction({
            signer: this.member,
            transactionActionType: transactionManagerSigner
              ? "execute"
              : "create_with_preauthorized_execution",
            transactionAddress: transactionBufferAddress,
            transactionMessageBytes: new Uint8Array(transactionMessageBytes),
            popUp,
          }),
          estimateJitoTips(),
        ]);
        const result = await prepareTransactionBundle({
          compressed: settingsData.isCompressed,
          index: this.index,
          bufferIndex,
          transactionMessageBytes,
          creator:
            transactionManagerSigner ??
            new Secp256r1Key(signedTx.signer, signedTx),
          executor: transactionManagerSigner
            ? new Secp256r1Key(signedTx.signer, signedTx)
            : undefined,
          jitoBundlesTipAmount,
          payer,
          additionalSigners,
          addressesByLookupTableAddress,
          cachedAccounts,
        });
        return await sendBundleTransaction(result);
      } else {
        const signedTx = await signPasskeyTransaction({
          signer: this.member,
          transactionActionType: "sync",
          transactionAddress: settings.toString(),
          transactionMessageBytes: new Uint8Array(transactionMessageBytes),
          popUp,
        });
        const result = await prepareTransactionSync({
          compressed: settingsData.isCompressed,
          signers: [
            new Secp256r1Key(signedTx.signer, signedTx),
            ...(additionalSigners ?? []),
            ...(transactionManagerSigner ? [transactionManagerSigner] : []),
          ],
          payer,
          transactionMessageBytes,
          index: this.index,
          addressesByLookupTableAddress,
          cachedAccounts,
        });
        return await sendNonBundleTransaction(
          result.ixs,
          result.payer,
          result.addressLookupTableAccounts
        );
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
