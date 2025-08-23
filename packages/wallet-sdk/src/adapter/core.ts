import { AuthenticatorAssertionResponseJSON } from "@simplewebauthn/server";
import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  estimateComputeUnitLimitFactory,
  getSetComputeUnitLimitInstruction,
} from "@solana-program/compute-budget";
import {
  AddressesByLookupTableAddress,
  appendTransactionMessageInstructions,
  assertIsFullySignedTransaction,
  Commitment,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  decompileTransactionMessage,
  fetchAddressesForLookupTables,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  getSignersFromTransactionMessage,
  getTransactionDecoder,
  getTransactionEncoder,
  Instruction,
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
import {
  checkIfSettingsAccountIsCompressed,
  fetchUserData,
} from "../compressed";
import {
  signMessage as signPasskeyMessage,
  signTransaction as signPasskeyTransaction,
  verifyMessage,
} from "../passkeys";
import {
  estimateTransactionSize,
  prepareTransactionBundle,
  prepareTransactionMessage,
  prepareTransactionSync,
} from "../transaction";
import { Secp256r1Key } from "../types";
import {
  getMultiWalletFromSettings,
  getSettingsFromIndex,
  getSolanaRpc,
  getSolanaRpcSubscriptions,
  getTransactionBufferAddress,
} from "../utils";
import { estimateJitoTips, getHash } from "../utils/internal";
import { base64URLStringToBuffer } from "../utils/passkeys/internal";
import {
  assertTransactionIsNotSigned,
  createSignInMessageText,
  getRandomPayer,
  sendJitoBundle,
} from "./util";
import { Revibase, RevibaseEvent } from "./window";

export function createRevibaseAdapter({
  payer,
  jitoBlockEngineEndpoint,
  estimateJitoTipEndpoint,
  expectedRPID,
  expectedOrigin,
  authUrl,
}: {
  estimateJitoTipEndpoint: string;
  jitoBlockEngineEndpoint: string;
  payer?: TransactionSigner;
  expectedOrigin?: string;
  expectedRPID?: string;
  authUrl?: string;
}): Revibase {
  const computeBudgetEstimate = estimateComputeUnitLimitFactory({
    rpc: getSolanaRpc(),
  });

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc: getSolanaRpc(),
    rpcSubscriptions: getSolanaRpcSubscriptions(),
  });
  const getBlockHeightExceedencePromise =
    createBlockHeightExceedencePromiseFactory({
      rpc: getSolanaRpc(),
      rpcSubscriptions: getSolanaRpcSubscriptions(),
    });
  const getRecentSignatureConfirmationPromise =
    createRecentSignatureConfirmationPromiseFactory({
      rpc: getSolanaRpc(),
      rpcSubscriptions: getSolanaRpcSubscriptions(),
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
    index: null,
    connect: async function (options?: { onlyIfTrusted?: boolean }) {
      try {
        if (options?.onlyIfTrusted) {
          const account = window.sessionStorage.getItem("Revibase:account");
          if (account) {
            const { publicKey, member, index } = JSON.parse(account) as {
              publicKey: string | null;
              member: { type: "ed25519" | "secp256r1"; value: string } | null;
              index: number | null;
            };
            this.publicKey = publicKey;
            this.member = member;
            this.index = index;
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
        this.index = null;
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
          assertIsFullySignedTransaction(signedTransaction);
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
        if (!this.member || !this.index)
          throw new Error("Wallet is not connected or member is not set.");
        if (this.member.type !== "secp256r1")
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
            ? await fetchAddressesForLookupTables(
                lookupTableAddresses,
                getSolanaRpc()
              )
            : undefined;
        const decompiledMessage = decompileTransactionMessage(compiledMessage, {
          addressesByLookupTableAddress,
        });

        if (!("blockhash" in decompiledMessage.lifetimeConstraint)) {
          throw new Error("Durable nonce is not supported.");
        }
        const additionalSigners = getSignersFromTransactionMessage(
          decompiledMessage
        ) as TransactionSigner[];

        const transactionMessageBytes = prepareTransactionMessage(
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
          payer: TransactionSigner;
          ixs: Instruction[];
          addressLookupTableAccounts?: AddressesByLookupTableAddress;
        }[] = [];

        const compressed = await checkIfSettingsAccountIsCompressed(this.index);
        const settings = await getSettingsFromIndex(this.index);
        payer = payer ?? (await getRandomPayer(`https://api.revibase.com`));
        if (
          (await estimateTransactionSize({
            additionalSigners,
            compressed,
            payer,
            settingsIndex: this.index,
            transactionMessageBytes,
          })) > 1644
        ) {
          const bufferIndex = Math.round(Math.random() * 255);
          const transactionBufferAddress = await getTransactionBufferAddress(
            settings,
            new Secp256r1Key(this.member.value),
            bufferIndex
          );
          const signedTx = await signPasskeyTransaction({
            publicKey: this.member.value,
            transactionActionType: "create_with_permissionless_execution",
            transactionAddress: transactionBufferAddress,
            transactionMessageBytes,
            authUrl,
          });
          const jitoBundlesTipAmount = await estimateJitoTips(
            estimateJitoTipEndpoint
          );

          const result = await prepareTransactionBundle({
            compressed,
            index: this.index,
            bufferIndex,
            transactionMessageBytes,
            creator: new Secp256r1Key(this.member.value, signedTx),
            jitoBundlesTipAmount,
            payer: payer,
            additionalSigners,
          });
          payload.push(...result);
        } else {
          const signedTx = await signPasskeyTransaction({
            publicKey: this.member.value,
            transactionActionType: "sync",
            transactionAddress: settings.toString(),
            transactionMessageBytes,
            authUrl,
          });
          payload.push(
            await prepareTransactionSync({
              compressed,
              signers: [
                new Secp256r1Key(this.member.value, signedTx),
                ...additionalSigners,
              ],
              payer: payer,
              transactionMessageBytes,
              index: this.index,
            })
          );
        }
        const latestBlockhash = await getSolanaRpc()
          .getLatestBlockhash()
          .send();
        for (const item of payload) {
          const parsedTransaction = await pipe(
            createTransactionMessage({ version: 0 }),
            (tx) => appendTransactionMessageInstructions(item.ixs, tx),
            (tx) => setTransactionMessageFeePayerSigner(item.payer, tx),
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
          authUrl,
        });
        const verified = await verifyMessage({
          message: decodedMessage,
          response,
          expectedOrigin,
          expectedRPID,
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
        index: number;
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
          authUrl,
        });
        const verified = await verifyMessage({
          message,
          response,
          expectedOrigin,
          expectedRPID,
        });
        if (!verified) {
          throw Error("Failed to verify signed message");
        }
        const member = new Secp256r1Key(response.publicKey);
        const userData = await fetchUserData(member);
        if (userData.settingsIndex.__option === "None") {
          throw Error("User has no delegated wallet");
        }
        const settings = await getSettingsFromIndex(
          userData.settingsIndex.value
        );
        this.publicKey = (
          await getMultiWalletFromSettings(settings)
        ).toString();
        this.member = { type: "secp256r1", value: member.toString() };
        this.index = Number(userData);
        window.sessionStorage.setItem(
          "Revibase:account",
          JSON.stringify({
            publicKey: this.publicKey,
            member: this.member,
            index: this.index,
          })
        );
        emit("accountChanged");

        const authenticatorData = new Uint8Array(
          base64URLStringToBuffer(
            response.authResponse.response.authenticatorData ?? ""
          )
        );
        const clientDataHash = getHash(
          new Uint8Array(
            base64URLStringToBuffer(
              response.authResponse.response.clientDataJSON
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
          index: this.index,
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
