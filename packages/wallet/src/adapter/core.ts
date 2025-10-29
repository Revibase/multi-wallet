import { address } from "gill";
import {
  signMessageWithPasskey,
  signTransactionWithPasskey,
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
  fetchSettingsAccountData,
  fetchUserAccountData,
  getFeePayer,
  getSettingsFromIndex,
  getSignedSecp256r1Key,
  getTransactionBufferAddress,
  getWalletAddressFromIndex,
} from "../utils";
import { resolveTransactionManagerSigner } from "../utils/transaction/helper";
import {
  estimateJitoTips,
  estimateTransactionSizeExceedLimit,
  simulateSecp256r1Signer,
} from "../utils/transaction/internal";
import { createSignInMessageText } from "./utils";
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
        const userAccountData = await fetchUserAccountData(authResponse.signer);
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

      this.member = authResponse.signer.toString();
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
      return await signMessageWithPasskey({
        signer: this.member ? new Secp256r1Key(this.member) : undefined,
        message: input,
      });
    },
    verify: async function (input) {
      return await verifyMessage({
        message: input.message,
        response: input.authResponse,
        expectedOrigin: input.expectedOrigin,
      });
    },
    signTransaction: async function (input) {
      if (!this.member || !this.index || !this.publicKey) {
        throw new Error("Wallet is not connected");
      }
      // open popup first so that browser won't prompt user for permission
      const popUp = createPopUp();
      let {
        addressesByLookupTableAddress,
        instructions,
        additionalSigners,
        cachedAccounts = new Map(),
        jitoTipsConfig,
      } = input;

      const [settingsData, settings, payer, transactionMessageBytes] =
        await Promise.all([
          fetchSettingsAccountData(this.index, cachedAccounts),
          getSettingsFromIndex(this.index),
          getFeePayer(),
          prepareTransactionMessage({
            payer: address(this.publicKey),
            instructions,
            addressesByLookupTableAddress,
          }),
        ]);
      const signer = new Secp256r1Key(this.member);

      const transactionManagerSigner = await resolveTransactionManagerSigner({
        signer,
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
          transactionManagerSigner ? transactionManagerSigner.address : signer,
          bufferIndex
        );
        const [authResponse, jitoBundlesTipAmount] = await Promise.all([
          signTransactionWithPasskey({
            signer,
            transactionActionType: transactionManagerSigner
              ? "execute"
              : "create_with_preauthorized_execution",
            transactionAddress: transactionBufferAddress,
            transactionMessageBytes: new Uint8Array(transactionMessageBytes),
            popUp,
          }),
          estimateJitoTips(jitoTipsConfig),
        ]);
        const signedSigner = await getSignedSecp256r1Key(authResponse);
        return await prepareTransactionBundle({
          compressed: settingsData.isCompressed,
          index: this.index,
          bufferIndex,
          transactionMessageBytes,
          creator: transactionManagerSigner ?? signedSigner,
          executor: transactionManagerSigner ? signedSigner : undefined,
          jitoBundlesTipAmount,
          payer,
          additionalSigners,
          addressesByLookupTableAddress,
          cachedAccounts,
        });
      } else {
        const authResponse = await signTransactionWithPasskey({
          signer,
          transactionActionType: "sync",
          transactionAddress: settings.toString(),
          transactionMessageBytes: new Uint8Array(transactionMessageBytes),
          popUp,
        });
        const signedSigner = await getSignedSecp256r1Key(authResponse);
        return [
          await prepareTransactionSync({
            compressed: settingsData.isCompressed,
            signers: [
              signedSigner,
              ...(additionalSigners ?? []),
              ...(transactionManagerSigner ? [transactionManagerSigner] : []),
            ],
            payer,
            transactionMessageBytes,
            index: this.index,
            addressesByLookupTableAddress,
            cachedAccounts,
          }),
        ];
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
