import { address, getAddressEncoder, getU64Encoder } from "gill";
import { SYSTEM_PROGRAM_ADDRESS } from "gill/programs";
import { nativeTransferIntent, tokenTransferIntent } from "../instructions";
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
  fetchDelegateData,
  fetchSettingsData,
  getFeePayer,
  getMultiWalletFromSettings,
  getSettingsFromIndex,
  getTransactionBufferAddress,
} from "../utils";
import {
  estimateJitoTips,
  estimateTransactionSizeExceedLimit,
  simulateSecp256r1Signer,
} from "../utils/transactionMessage/helper";
import {
  ADDRESS_BY_LOOKUP_TABLE_ADDRESS,
  createSignInMessageText,
  resolveTransactionManagerSigner,
  sendBundleTransaction,
  sendNonBundleTransaction,
} from "./util";
import type { Revibase, RevibaseEvent } from "./window";

export function createRevibaseAdapter({
  additionalInfo,
  authorizedClients,
}: {
  additionalInfo?: any;
  authorizedClients?: { publicKey: string; url: string };
}): Revibase {
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
        const delegateData = await fetchDelegateData(
          new Secp256r1Key(authResponse.signer)
        );
        if (delegateData.settingsIndex.__option === "None") {
          throw Error("User has no delegated wallet");
        }
        const settings = await getSettingsFromIndex(
          delegateData.settingsIndex.value
        );
        this.publicKey = (
          await getMultiWalletFromSettings(settings)
        ).toString();
        this.index = Number(delegateData.settingsIndex.value);
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
        additionalInfo,
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
    signAndSendNativeTransferIntent: async function (input) {
      const signedTx = await signPasskeyTransaction({
        transactionActionType: "transfer_intent",
        transactionAddress: SYSTEM_PROGRAM_ADDRESS.toString(),
        transactionMessageBytes: new Uint8Array([
          ...getU64Encoder().encode(input.amount),
          ...getAddressEncoder().encode(input.destination),
          ...getAddressEncoder().encode(SYSTEM_PROGRAM_ADDRESS),
        ]),
        additionalInfo,
      });
      let index: number;
      if (
        !signedTx.additionalInfo?.walletAddress ||
        !signedTx.additionalInfo.settingsIndex
      ) {
        const delegateData = await fetchDelegateData(
          new Secp256r1Key(signedTx.signer)
        );
        if (delegateData.settingsIndex.__option === "None") {
          throw Error("User has no delegated wallet");
        }
        index = Number(delegateData.settingsIndex.value);
      } else {
        index = signedTx.additionalInfo.settingsIndex;
      }
      const [settingsData, payer] = await Promise.all([
        fetchSettingsData(index),
        getFeePayer(),
      ]);
      const transactionManagerSigner = await resolveTransactionManagerSigner({
        memberKey: signedTx.signer,
        settingsData,
        authorizedClients,
      });
      const ixs = await nativeTransferIntent({
        index,
        amount: input.amount,
        signers: [
          new Secp256r1Key(signedTx.signer, signedTx),
          ...(transactionManagerSigner ? [transactionManagerSigner] : []),
        ],
        destination: input.destination,
        compressed: settingsData.isCompressed,
      });
      return await sendNonBundleTransaction(
        ixs,
        payer,
        ADDRESS_BY_LOOKUP_TABLE_ADDRESS
      );
    },
    signAndSendTokenTransferIntent: async function (input) {
      const signedTx = await signPasskeyTransaction({
        transactionActionType: "transfer_intent",
        transactionAddress: input.tokenProgram.toString(),
        transactionMessageBytes: new Uint8Array([
          ...getU64Encoder().encode(input.amount),
          ...getAddressEncoder().encode(input.destination),
          ...getAddressEncoder().encode(input.mint),
        ]),
        additionalInfo,
      });
      let index: number;
      if (
        !signedTx.additionalInfo?.walletAddress ||
        !signedTx.additionalInfo.settingsIndex
      ) {
        const delegateData = await fetchDelegateData(
          new Secp256r1Key(signedTx.signer)
        );
        if (delegateData.settingsIndex.__option === "None") {
          throw Error("User has no delegated wallet");
        }
        index = Number(delegateData.settingsIndex.value);
      } else {
        index = signedTx.additionalInfo.settingsIndex;
      }
      const [settingsData, payer] = await Promise.all([
        fetchSettingsData(index),
        getFeePayer(),
      ]);

      const transactionManagerSigner = await resolveTransactionManagerSigner({
        memberKey: signedTx.signer,
        settingsData,
        authorizedClients: authorizedClients,
      });
      const ixs = await tokenTransferIntent({
        index,
        amount: input.amount,
        signers: [
          new Secp256r1Key(signedTx.signer, signedTx),
          ...(transactionManagerSigner ? [transactionManagerSigner] : []),
        ],
        destination: input.destination,
        mint: input.mint,
        tokenProgram: input.tokenProgram,
        compressed: settingsData.isCompressed,
      });
      return await sendNonBundleTransaction(
        ixs,
        payer,
        ADDRESS_BY_LOOKUP_TABLE_ADDRESS
      );
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
        cachedCompressedAccounts = new Map(),
      } = input;

      addressesByLookupTableAddress = {
        ...(addressesByLookupTableAddress ?? {}),
        ...ADDRESS_BY_LOOKUP_TABLE_ADDRESS,
      };

      const [settingsData, settings, payer, transactionMessageBytes] =
        await Promise.all([
          fetchSettingsData(this.index, cachedCompressedAccounts),
          getSettingsFromIndex(this.index),
          getFeePayer(),
          prepareTransactionMessage({
            payer: address(this.publicKey),
            instructions,
            addressesByLookupTableAddress,
          }),
        ]);

      const transactionManagerSigner = await resolveTransactionManagerSigner({
        memberKey: this.member,
        settingsData,
        transactionMessageBytes,
        authorizedClients: authorizedClients,
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
        cachedCompressedAccounts,
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
              : "create_with_permissionless_execution",
            transactionAddress: transactionBufferAddress,
            transactionMessageBytes,
            additionalInfo,
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
          cachedCompressedAccounts,
        });
        return await sendBundleTransaction(result);
      } else {
        const signedTx = await signPasskeyTransaction({
          signer: this.member,
          transactionActionType: "sync",
          transactionAddress: settings.toString(),
          transactionMessageBytes,
          additionalInfo,
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
          cachedCompressedAccounts,
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
