import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  estimateComputeUnitLimitFactory,
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  AddressesByLookupTableAddress,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  decompileTransactionMessage,
  fetchAddressesForLookupTables,
  getCompiledTransactionMessageDecoder,
  getSignersFromTransactionMessage,
  getTransactionDecoder,
  getTransactionEncoder,
  Instruction,
  isSolanaError,
  partiallySignTransactionMessageWithSigners,
  pipe,
  prependTransactionMessageInstructions,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  TransactionSigner,
} from "@solana/kit";
import {
  SolanaSignInInput,
  SolanaSignInOutput,
} from "@solana/wallet-standard-features";
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
import { Secp256r1Key, SignerPayload } from "../types";
import {
  checkIfSettingsAccountIsCompressed,
  getFeePayer,
  getMultiWalletFromSettings,
  getSettingsFromIndex,
  getSolanaRpc,
  getTransactionBufferAddress,
} from "../utils";
import { base64URLStringToBuffer } from "../utils/passkeys/internal";
import { getHash } from "../utils/transactionMessage/internal";
import {
  assertTransactionIsNotSigned,
  createSignInMessageText,
  estimateJitoTips,
  getMedianPriorityFees,
  JitoTipsConfig,
} from "./util";
import { Revibase, RevibaseEvent } from "./window";

export function createRevibaseAdapter({
  jitoTipsConfig,
  expectedRPID,
  expectedOrigin,
  authUrl,
}: {
  jitoTipsConfig: JitoTipsConfig;
  expectedOrigin?: string;
  expectedRPID?: string;
  authUrl?: string;
}): Revibase {
  const computeBudgetEstimate = estimateComputeUnitLimitFactory({
    rpc: getSolanaRpc(),
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
              member: SignerPayload | null;
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
    signTransaction: async function (
      transaction: Uint8Array
    ): Promise<Uint8Array[]> {
      try {
        const outputs: Uint8Array[] = [];
        if (!this.member || !this.index || !this.publicKey)
          throw new Error("Wallet is not connected or member is not set.");

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
        additionalSigners.filter(
          (x) => x.address.toString() !== this.publicKey
        );

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
          payer: TransactionSigner;
          ixs: Instruction[];
          addressLookupTableAccounts?: AddressesByLookupTableAddress;
        }[] = [];

        const compressed = await checkIfSettingsAccountIsCompressed(this.index);
        const settings = await getSettingsFromIndex(this.index);

        if (
          (await estimateTransactionSize({
            additionalSigners,
            compressed,
            payer: getFeePayer(),
            settingsIndex: this.index,
            transactionMessageBytes,
          })) > 1644
        ) {
          const bufferIndex = Math.round(Math.random() * 255);
          const transactionBufferAddress = await getTransactionBufferAddress(
            settings,
            new Secp256r1Key(this.member.publicKey),
            bufferIndex
          );

          const signedTx = await signPasskeyTransaction({
            signer: this.member,
            transactionActionType: "create_with_permissionless_execution",
            transactionAddress: transactionBufferAddress,
            transactionMessageBytes,
            authUrl,
          });
          const jitoBundlesTipAmount = await estimateJitoTips(jitoTipsConfig);

          const result = await prepareTransactionBundle({
            compressed,
            index: this.index,
            bufferIndex,
            transactionMessageBytes,
            creator: new Secp256r1Key(signedTx.signer.publicKey, signedTx),
            jitoBundlesTipAmount,
            payer: getFeePayer(),
            additionalSigners,
          });
          payload.push(...result);
        } else {
          const signedTx = await signPasskeyTransaction({
            signer: this.member,
            transactionActionType: "sync",
            transactionAddress: settings.toString(),
            transactionMessageBytes,
            authUrl,
          });
          payload.push(
            await prepareTransactionSync({
              compressed,
              signers: [
                new Secp256r1Key(signedTx.signer.publicKey, signedTx),
                ...additionalSigners,
              ],
              payer: getFeePayer(),
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
            async (tx) => {
              const [estimatedUnits, priorityFees] = await Promise.all([
                computeBudgetEstimate(tx),
                getMedianPriorityFees(
                  getSolanaRpc(),
                  tx.instructions.flatMap((x) => x.accounts ?? [])
                ),
              ]);
              const computeUnits = Math.ceil(estimatedUnits * 1.1);
              return prependTransactionMessageInstructions(
                [
                  ...(computeUnits > 200_000
                    ? [
                        getSetComputeUnitLimitInstruction({
                          units: computeUnits,
                        }),
                      ]
                    : []),
                  ...(priorityFees > 0
                    ? [
                        getSetComputeUnitPriceInstruction({
                          microLamports: priorityFees,
                        }),
                      ]
                    : []),
                ],
                tx
              );
            },
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
    ): Promise<{ signature: Uint8Array; signedMessage: Uint8Array }> {
      try {
        if (!this.member) {
          throw new Error("Invalid account member");
        }

        const decodedMessage = new TextDecoder().decode(message);

        const response = await signPasskeyMessage({
          message: decodedMessage,
          signer: this.member,
          authUrl,
        });

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
        const signedMessage = new Uint8Array(
          authenticatorData.length + clientDataHash.length
        );
        signedMessage.set(authenticatorData);
        signedMessage.set(clientDataHash, authenticatorData.length);

        const signature = new Uint8Array(
          base64URLStringToBuffer(response.authResponse.response.signature)
        );

        return { signedMessage, signature };
      } catch (error) {
        console.error("signMessage() failed:", error);
        throw error;
      }
    },
    signIn: async function (input?: SolanaSignInInput): Promise<
      {
        publicKey: string;
        member: SignerPayload;
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
        this.member = response.signer;
        if (!this.member.settingsIndex) {
          throw Error("User has no delegated wallet");
        }
        this.index = this.member.settingsIndex;
        const settings = await getSettingsFromIndex(this.index);
        this.publicKey = (
          await getMultiWalletFromSettings(settings)
        ).toString();

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
        const signedMessage = new Uint8Array(
          authenticatorData.length + clientDataHash.length
        );
        signedMessage.set(authenticatorData);
        signedMessage.set(clientDataHash, authenticatorData.length);
        const signature = new Uint8Array(
          base64URLStringToBuffer(response.authResponse.response.signature)
        );
        return {
          publicKey: this.publicKey,
          member: this.member,
          index: this.index,
          signedMessage,
          signature,
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
