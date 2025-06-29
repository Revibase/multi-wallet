import { AuthenticatorAssertionResponseJSON } from "@simplewebauthn/server";
import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  getSetComputeUnitLimitInstruction,
} from "@solana-program/compute-budget";
import {
  address,
  AddressesByLookupTableAddress,
  appendTransactionMessageInstructions,
  assertTransactionIsFullySigned,
  Commitment,
  compressTransactionMessageUsingAddressLookupTables,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  decompileTransactionMessage,
  fetchAddressesForLookupTables,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getComputeUnitEstimateForTransactionMessageFactory,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  IInstruction,
  isSolanaError,
  partiallySignTransactionMessageWithSigners,
  pipe,
  prependTransactionMessageInstructions,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  Transaction,
  TransactionSigner,
} from "@solana/kit";
import {
  createBlockHeightExceedencePromiseFactory,
  createRecentSignatureConfirmationPromiseFactory,
  TransactionWithLastValidBlockHeight,
  waitForRecentTransactionConfirmation,
} from "@solana/transaction-confirmation";
import {
  SolanaSignAndSendTransactionOptions,
  SolanaSignInInput,
  SolanaSignInOutput,
} from "@solana/wallet-standard-features";
import { fetchDelegate } from "../generated";
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
  getDelegateAddress,
  getMultiWalletFromSettings,
  getTransactionBufferAddress,
} from "../utils";
import { base64URLStringToBuffer } from "../utils/passkeys/internal";
import {
  assertTransactionIsNotSigned,
  createSignInMessageText,
  estimateJitoTips,
  sendJitoBundle,
} from "./util";
import { Revibase, RevibaseEvent } from "./window";

export function createRevibaseAdapter({
  feePayer,
  jitoBlockEngineEndpoint,
  estimateJitoTipEndpoint,
  rpcEndpoint,
}: {
  feePayer: TransactionSigner;
  estimateJitoTipEndpoint: string;
  jitoBlockEngineEndpoint: string;
  rpcEndpoint: string;
}): Revibase {
  const rpc = createSolanaRpc(rpcEndpoint);
  const rpcSubscriptions = createSolanaRpcSubscriptions(
    "wss://" + new URL(rpcEndpoint).hostname
  );
  const computeBudgetEstimate =
    getComputeUnitEstimateForTransactionMessageFactory({
      rpc,
    });

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });
  const getBlockHeightExceedencePromise =
    createBlockHeightExceedencePromiseFactory({
      rpc,
      rpcSubscriptions,
    });
  const getRecentSignatureConfirmationPromise =
    createRecentSignatureConfirmationPromiseFactory({
      rpc,
      rpcSubscriptions,
    });
  const confirmTransaction = (config: {
    transaction: Readonly<Transaction & TransactionWithLastValidBlockHeight>;
    commitment: Commitment;
  }) =>
    waitForRecentTransactionConfirmation({
      getBlockHeightExceedencePromise,
      getRecentSignatureConfirmationPromise,
      ...config,
    });
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

  return {
    publicKey: null,
    member: null,
    settings: null,
    connect: async function (options?: { onlyIfTrusted?: boolean }) {
      try {
        if (options?.onlyIfTrusted) {
          const account = window.sessionStorage.getItem("Revibase:account");
          if (account) {
            const { publicKey, member, settings } = JSON.parse(account) as {
              publicKey: string | null;
              member: { type: "ed25519" | "secp256r1"; value: string } | null;
              settings: string | null;
            };
            this.publicKey = publicKey;
            this.member = member;
            this.settings = settings;
            emit("connect");
            return;
          }
        }
        await this.signIn({ statement: "Sign In With Your Passkey." });
        emit("connect");
      } catch (error) {
        console.error("connect() failed:", error);
        throw error;
      }
    },
    disconnect: function (): void {
      try {
        this.publicKey = null;
        this.member = null;
        this.settings = null;
        window.sessionStorage.removeItem("Revibase:account");
        emit("disconnect");
      } catch (error) {
        console.error("disconnect() failed:", error);
        throw error;
      }
    },
    signAndSendTransaction: async function (
      transaction: Uint8Array,
      options?: SolanaSignAndSendTransactionOptions
    ): Promise<string> {
      try {
        const signedTransactions = (
          await this.signTransaction(transaction)
        ).map(getTransactionDecoder().decode);

        let signature: string;
        if (signedTransactions.length === 1) {
          const signedTransaction = signedTransactions[0];
          assertTransactionIsFullySigned(signedTransaction);
          await sendAndConfirm(
            {
              ...signedTransaction,
              lifetimeConstraint: {
                lastValidBlockHeight: 2n ** 64n - 1n,
              },
            },
            {
              commitment: "confirmed",
              ...options,
              minContextSlot: options?.minContextSlot
                ? BigInt(options.minContextSlot)
                : undefined,
              maxRetries: options?.maxRetries
                ? BigInt(options.maxRetries)
                : undefined,
            }
          );
          signature = getSignatureFromTransaction(signedTransaction);
        } else {
          await sendJitoBundle(
            jitoBlockEngineEndpoint,
            signedTransactions.map(getBase64EncodedWireTransaction)
          );
          const lastTransaction =
            signedTransactions[signedTransactions.length - 1];
          await confirmTransaction({
            transaction: {
              ...lastTransaction,
              lifetimeConstraint: {
                lastValidBlockHeight: 2n ** 64n - 1n,
              },
            },
            commitment: "confirmed",
            ...options,
          });
          signature = getSignatureFromTransaction(lastTransaction);
        }

        return signature;
      } catch (error) {
        console.error("signAndSendTransaction() failed:", error);
        throw error;
      }
    },
    signTransaction: async function (
      transaction: Uint8Array
    ): Promise<Uint8Array[]> {
      try {
        const outputs: Uint8Array[] = [];
        const member = this.member;
        const settings = this.settings;
        if (!member || !settings)
          throw new Error("Wallet is not connected or member is not set.");
        if (member.type !== "secp256r1")
          throw new Error("Only secp256r1 keys are supported for signing.");
        const { messageBytes, signatures } =
          getTransactionDecoder().decode(transaction);
        assertTransactionIsNotSigned(signatures);
        const compiledMessage =
          getCompiledTransactionMessageDecoder().decode(messageBytes);
        const lookupTables =
          "addressTableLookups" in compiledMessage &&
          compiledMessage.addressTableLookups !== undefined &&
          compiledMessage.addressTableLookups.length > 0
            ? compiledMessage.addressTableLookups
            : [];
        const lookupTableAddresses = lookupTables.map(
          (l) => l.lookupTableAddress
        );
        const addressesByLookupTableAddress =
          lookupTableAddresses.length > 0
            ? await fetchAddressesForLookupTables(lookupTableAddresses, rpc)
            : undefined;
        const decompiledMessage = decompileTransactionMessage(compiledMessage, {
          addressesByLookupTableAddress,
        });

        if (!("blockhash" in decompiledMessage.lifetimeConstraint)) {
          throw new Error("Durable nonce is not supported.");
        }

        const transactionMessageBytes = await prepareTransactionMessage(
          decompiledMessage.lifetimeConstraint.blockhash.toString(),
          decompiledMessage.feePayer.address,
          decompiledMessage.instructions.filter(
            (x, index) =>
              !(
                index <= 1 &&
                x.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS
              )
          ),
          addressesByLookupTableAddress
        );

        const payload: {
          id: string;
          signers: string[];
          feePayer: TransactionSigner;
          ixs: IInstruction[];
          addressLookupTableAccounts?: AddressesByLookupTableAddress;
        }[] = [];
        if (transactionMessageBytes.length < 400) {
          const result = await signPasskeyTransaction({
            publicKey: member.value,
            transactionActionType: "sync",
            transactionAddress: settings,
            transactionMessageBytes,
          });
          payload.push(
            await prepareTransactionSync({
              rpc,
              signers: [new Secp256r1Key(member.value, result)],
              feePayer,
              transactionMessageBytes,
              settings: address(settings),
            })
          );
        } else {
          const bufferIndex = Math.round(Math.random() * 255);
          const transactionBufferAddress = await getTransactionBufferAddress(
            address(settings),
            new Secp256r1Key(member.value),
            bufferIndex
          );

          const signedTx = await signPasskeyTransaction({
            publicKey: member.value,
            transactionActionType: "create_with_permissionless_execution",
            transactionAddress: transactionBufferAddress,
            transactionMessageBytes,
          });
          const jitoBundlesTipAmount = await estimateJitoTips(
            estimateJitoTipEndpoint
          );
          payload.push(
            ...(await prepareTransactionBundle({
              rpc,
              feePayer,
              settings: address(settings),
              bufferIndex,
              transactionMessageBytes,
              creator: new Secp256r1Key(member.value, signedTx),
              jitoBundlesTipAmount,
            }))
          );
        }
        const latestBlockhash = await rpc.getLatestBlockhash().send();
        for (const item of payload) {
          const parsedTransaction = await pipe(
            createTransactionMessage({ version: 0 }),
            (tx) => appendTransactionMessageInstructions(item.ixs, tx),
            (tx) => setTransactionMessageFeePayerSigner(item.feePayer, tx),
            (tx) =>
              setTransactionMessageLifetimeUsingBlockhash(
                latestBlockhash.value,
                tx
              ),
            (tx) =>
              item.addressLookupTableAccounts
                ? compressTransactionMessageUsingAddressLookupTables(
                    tx,
                    item.addressLookupTableAccounts
                  )
                : tx,
            async (tx) =>
              prependTransactionMessageInstructions(
                [
                  getSetComputeUnitLimitInstruction({
                    units: (await computeBudgetEstimate(tx)) * 1.1,
                  }),
                ],
                tx
              ),
            async (tx) =>
              await partiallySignTransactionMessageWithSigners(await tx)
          );
          outputs.push(
            new Uint8Array(getTransactionEncoder().encode(parsedTransaction))
          );
        }

        return outputs;
      } catch (error) {
        console.error("signTransaction() failed:", error);
        if (isSolanaError(error)) {
          throw new Error(JSON.stringify(error.cause));
        } else {
          throw new Error(JSON.stringify(error));
        }
      }
    },
    signMessage: async function (
      message: Uint8Array
    ): Promise<{ signature: Uint8Array }> {
      try {
        if (!this.member) {
          throw new Error("Invalid account member");
        }
        if (this.member.type !== "secp256r1")
          throw new Error("Only secp256r1 keys are supported for signing.");
        const decodedMessage = new TextDecoder().decode(message);

        const response = await signPasskeyMessage({
          message: decodedMessage,
          publicKey: this.member.value,
        });
        const verified = await verifyMessage({
          message: decodedMessage,
          response,
        });
        if (!verified) {
          throw Error("Failed to verify signed message");
        }

        return {
          signature: new Uint8Array(
            base64URLStringToBuffer(
              (
                response.authResponse
                  .response as AuthenticatorAssertionResponseJSON
              ).signature
            )
          ),
        };
      } catch (error) {
        console.error("signMessage() failed:", error);
        throw error;
      }
    },
    signIn: async function (input?: SolanaSignInInput): Promise<
      {
        publicKey: string;
        member: { type: "ed25519" | "secp256r1"; value: string };
        settings: string;
      } & Omit<SolanaSignInOutput, "account">
    > {
      try {
        const message = createSignInMessageText({
          ...input,
          domain: input?.domain ?? window.location.origin,
          address: input?.address ?? this.publicKey ?? undefined,
          nonce: crypto.randomUUID(),
        });

        const response = await signPasskeyMessage({
          message,
        });
        const verified = await verifyMessage({ message, response });
        if (!verified) {
          throw Error("Failed to verify signed message");
        }
        const member = new Secp256r1Key(response.publicKey);
        const delegate = await fetchDelegate(
          rpc,
          await getDelegateAddress(member)
        );
        const settings = delegate.data.multiWalletSettings;
        const address = await getMultiWalletFromSettings(settings);
        this.publicKey = address.toString();
        this.member = { type: "secp256r1", value: member.toString() };
        this.settings = settings.toString();
        window.sessionStorage.setItem(
          "Revibase:account",
          JSON.stringify({
            publicKey: this.publicKey,
            member: this.member,
            settings: this.settings,
          })
        );
        emit("accountChanged");

        const authenticatorData = new Uint8Array(
          base64URLStringToBuffer(
            response.authResponse.response.authenticatorData ?? ""
          )
        );
        const clientDataHash = new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            base64URLStringToBuffer(
              response.authResponse.response.clientDataJSON ?? ""
            )
          )
        );
        const concatenatedData = new Uint8Array(
          authenticatorData.length + clientDataHash.length
        );
        concatenatedData.set(authenticatorData);
        concatenatedData.set(clientDataHash, authenticatorData.length);

        return {
          publicKey: this.publicKey,
          member: this.member,
          settings: this.settings,
          signedMessage: concatenatedData,
          signature: new Uint8Array(
            base64URLStringToBuffer(
              (
                response.authResponse
                  .response as AuthenticatorAssertionResponseJSON
              ).signature
            )
          ),
        };
      } catch (error) {
        console.error("signIn() failed:", error);
        throw error;
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
