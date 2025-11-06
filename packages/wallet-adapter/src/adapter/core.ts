import {
  createPopUp,
  fetchSettingsAccountData,
  fetchUserAccountData,
  getFeePayer,
  getSettingsFromIndex,
  getSignedSecp256r1Key,
  getTransactionBufferAddress,
  getWalletAddressFromIndex,
  prepareTransactionBundle,
  prepareTransactionMessage,
  prepareTransactionSync,
  resolveTransactionManagerSigner,
  Secp256r1Key,
  signAndSendBundledTransactions,
  signAndSendTransaction,
  signMessageWithPasskey,
  signTransactionWithPasskey,
  verifyMessage,
  type SettingsIndexWithAddress,
} from "@revibase/core";
import { address } from "gill";
import {
  createSignInMessageText,
  estimateJitoTips,
  estimateTransactionSizeExceedLimit,
  simulateSecp256r1Signer,
} from "./utils";
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
  const { publicKey, member, settingsIndexWithAddress } = account
    ? (JSON.parse(account) as {
        publicKey: string | null;
        member: string | null;
        settingsIndexWithAddress: SettingsIndexWithAddress | null;
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
      const verified = await this.verify({ message, authResponse });
      if (!verified) {
        throw Error("Failed to verify signed message");
      }
      if (
        !authResponse.additionalInfo?.walletAddress ||
        !authResponse.additionalInfo.settingsIndex
      ) {
        const userAccountData = await fetchUserAccountData(authResponse.signer);
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
        this.publicKey = authResponse.additionalInfo.walletAddress;
        this.settingsIndexWithAddress =
          authResponse.additionalInfo.settingsIndexWithAddress;
      }

      this.member = authResponse.signer.toString();
      window.localStorage.setItem(
        "Revibase:account",
        JSON.stringify({
          publicKey: this.publicKey,
          member: this.member,
          settingsIndexWithAddress: this.settingsIndexWithAddress,
        })
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
    buildTransaction: async function (input) {
      if (!this.member || !this.settingsIndexWithAddress || !this.publicKey) {
        throw new Error("Wallet is not connected");
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
          fetchSettingsAccountData(
            this.settingsIndexWithAddress.index,
            this.settingsIndexWithAddress.settingsAddressTreeIndex,
            cachedAccounts
          ),
          getSettingsFromIndex(this.settingsIndexWithAddress.index),
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
        index: this.settingsIndexWithAddress.index,
        settingsAddressTreeIndex:
          this.settingsIndexWithAddress.settingsAddressTreeIndex,
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
        index: this.settingsIndexWithAddress.index,
        settingsAddressTreeIndex:
          this.settingsIndexWithAddress.settingsAddressTreeIndex,
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
          estimateJitoTips(),
        ]);
        const signedSigner = await getSignedSecp256r1Key(authResponse);
        return await prepareTransactionBundle({
          compressed: settingsData.isCompressed,
          index: this.settingsIndexWithAddress.index,
          settingsAddressTreeIndex:
            this.settingsIndexWithAddress.settingsAddressTreeIndex,
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
            index: this.settingsIndexWithAddress.index,
            settingsAddressTreeIndex:
              this.settingsIndexWithAddress.settingsAddressTreeIndex,
            addressesByLookupTableAddress,
            cachedAccounts,
          }),
        ];
      }
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
