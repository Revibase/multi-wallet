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
  blockhash,
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
  partiallySignTransactionMessageWithSigners,
  pipe,
  prependTransactionMessageInstructions,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  TransactionSigner,
} from "@solana/kit";
import {
  SolanaSignAndSendTransactionOptions,
  SolanaSignInInput,
  SolanaSignInOutput,
} from "@solana/wallet-standard-features";
import { fetchDelegate } from "../generated";
import {
  signMessage,
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
  getRandomPayer,
  pollJitoBundleForConfirmation,
  sendJitoBundle,
} from "./util";
import { Revibase, RevibaseEvent } from "./window";

export function createRevibaseAdapter(
  rpcEndpoint: string,
  payer?: TransactionSigner
): Revibase {
  const rpc = createSolanaRpc(rpcEndpoint);
  const computeBudgetEstimate =
    getComputeUnitEstimateForTransactionMessageFactory({
      rpc,
    });

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions: createSolanaRpcSubscriptions(
      "wss://" + new URL(rpcEndpoint).hostname
    ),
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
    },
    disconnect: function (): void {
      this.publicKey = null;
      this.member = null;
      this.settings = null;
      window.sessionStorage.removeItem("Revibase:account");
      emit("disconnect");
    },
    signAndSendTransaction: async function (
      transaction: Uint8Array,
      options?: SolanaSignAndSendTransactionOptions
    ): Promise<string> {
      const signedTransactions = (await this.signTransaction(transaction)).map(
        getTransactionDecoder().decode
      );

      let signature: string;
      if (signedTransactions.length === 1) {
        const signedTransaction = signedTransactions[0];
        assertTransactionIsFullySigned(signedTransaction);
        await sendAndConfirm(
          {
            ...signedTransaction,
            lifetimeConstraint: {
              blockhash: blockhash(
                getCompiledTransactionMessageDecoder().decode(
                  signedTransaction.messageBytes
                ).lifetimeToken
              ),
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
        const bundleId = await sendJitoBundle(
          signedTransactions.map(getBase64EncodedWireTransaction)
        );
        signature = await pollJitoBundleForConfirmation(bundleId);
      }

      return signature;
    },
    signTransaction: async function (
      transaction: Uint8Array
    ): Promise<Uint8Array[]> {
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
            !(index <= 1 && x.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS)
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

        const feePayer = payer ?? (await getRandomPayer());
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
        const jitoBundlesTipAmount = await estimateJitoTips();
        const feePayer = payer ?? (await getRandomPayer());

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
    },
    signMessage: async function (
      message: Uint8Array
    ): Promise<{ signature: Uint8Array }> {
      if (!this.member) {
        throw new Error("Invalid account member");
      }
      if (this.member.type !== "secp256r1")
        throw new Error("Only secp256r1 keys are supported for signing.");
      const decodedMessage = new TextDecoder().decode(message);
      const signMessagePayload = await signPasskeyMessage({
        message: decodedMessage,
        publicKey: this.member.value,
      });

      if (
        await verifyMessage({
          message: decodedMessage,
          response: signMessagePayload,
        })
      ) {
        return {
          signature: new Uint8Array(
            base64URLStringToBuffer(
              (
                signMessagePayload.authResponse
                  .response as AuthenticatorAssertionResponseJSON
              ).signature
            )
          ),
        };
      } else {
        throw new Error("Failed to verify signed message");
      }
    },
    signIn: async function (input?: SolanaSignInInput): Promise<
      {
        publicKey: string;
        member: { type: "ed25519" | "secp256r1"; value: string };
        settings: string;
      } & Omit<SolanaSignInOutput, "account">
    > {
      const message = createSignInMessageText({
        ...input,
        domain: input?.domain ?? window.location.origin,
        address: input?.address ?? this.publicKey ?? undefined,
        nonce: crypto.randomUUID(),
      });

      const signInPayload = await signMessage({
        message,
      });
      if (await verifyMessage({ message, response: signInPayload })) {
        const member = new Secp256r1Key(signInPayload.publicKey);
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
            signInPayload.authResponse.response.authenticatorData ?? ""
          )
        );
        const clientDataHash = new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            base64URLStringToBuffer(
              signInPayload.authResponse.response.clientDataJSON ?? ""
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
                signInPayload.authResponse
                  .response as AuthenticatorAssertionResponseJSON
              ).signature
            )
          ),
        };
      } else {
        throw new Error("Failed to verify signed message");
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
