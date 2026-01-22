import type { TransactionPayloadWithBase64MessageBytes } from "@revibase/core";
import {
  base64URLStringToBuffer,
  fetchSettingsAccountData,
  getSettingsFromIndex,
  UserRole,
} from "@revibase/core";
import {
  createNoopSigner,
  getAddressDecoder,
  type TransactionSigner,
} from "gill";
import {
  CompleteMessageRequestSchema,
  CompleteTransactionRequestSchema,
  StartCustomMessageRequestSchema,
  StartCustomTransactionRequestSchema,
  type CompleteMessageRequest,
  type CompleteTransactionRequest,
  type StartCustomMessageRequest,
  type StartCustomTransactionRequest,
  type User,
} from "src/utils";
import {
  createSignInMessageText,
  estimateTransactionSizeExceedLimit,
  getAddressByLookUpTable,
  simulateSecp256r1Signer,
} from "src/utils/internal";
import z from "zod";
import { processBundledTransaction } from "./processBundledTransaction";
import { processGetResult } from "./processGetResult";
import { processMessage } from "./processMessage";
import { processStartRequest } from "./processStartRequest";
import { processSyncTransaction } from "./processSyncTransaction";
import { processTokenTransfer } from "./processTokenTransfer";

/**
 * Processes client authorization callbacks for both messages and transactions.
 * Handles the complete authentication and transaction flow.
 *
 * @param request - Start or complete request (message or transaction)
 * @param privateKey - Ed25519 private key for signing
 * @param feePayer - Optional fee payer for transactions
 * @param providerOrigin - Optional expected origin for verification
 * @param rpId - Optional expected Relying Party ID for verification
 * @returns Result containing signature, message, user, or transaction signature
 * @throws {Error} If request phase or type is invalid
 */
export async function processClientAuthCallback({
  request,
  privateKey,
  feePayer,
  providerOrigin,
  rpId,
}: {
  request:
    | StartCustomTransactionRequest
    | StartCustomMessageRequest
    | CompleteMessageRequest
    | CompleteTransactionRequest;
  privateKey: CryptoKey;
  feePayer?: TransactionSigner;
  providerOrigin?: string;
  rpId?: string;
}): Promise<{ rid: string } | { user: User } | { txSig: string }> {
  // Parse and validate early to fail fast
  const parsedResult = z
    .union([
      StartCustomTransactionRequestSchema,
      StartCustomMessageRequestSchema,
      CompleteTransactionRequestSchema,
      CompleteMessageRequestSchema,
    ])
    .parse(request);

  if (parsedResult.phase === "start") {
    const { data, signer } = parsedResult;

    if (data.type === "message") {
      return await processStartRequest({
        request: {
          phase: "start",
          redirectOrigin: parsedResult.redirectOrigin,
          signer: parsedResult.signer?.publicKey,
          data: {
            type: "message",
            payload: createSignInMessageText({
              domain: parsedResult.redirectOrigin,
              nonce: crypto.randomUUID(),
            }),
          },
        },
        privateKey,
        providerOrigin,
        rid: data.rid,
      });
    }

    const { transactionPayload } = await getTransactionPayload(
      data.payload,
      signer,
    );

    return await processStartRequest({
      request: {
        phase: "start",
        redirectOrigin: parsedResult.redirectOrigin,
        signer: parsedResult.signer?.publicKey,
        data: {
          type: "transaction",
          payload: transactionPayload,
        },
      },
      providerOrigin,
      privateKey,
      rid: data.rid,
    });
  }

  const result = await processGetResult({
    rid: parsedResult.data.rid,
    providerOrigin,
    privateKey,
  });

  if (result.data.type === "message") {
    return {
      user: await processMessage(
        { phase: "complete", data: result.data },
        providerOrigin,
        rpId,
      ),
    };
  }

  const completeRequest = {
    phase: "complete" as const,
    data: result.data,
  } as const;

  const { transactionActionType } = result.data.payload.transactionPayload;

  switch (transactionActionType) {
    case "transfer_intent":
      return {
        txSig: await processTokenTransfer(
          completeRequest,
          privateKey,
          feePayer,
        ),
      };
    case "sync":
      return {
        txSig: await processSyncTransaction(
          completeRequest,
          privateKey,
          feePayer,
        ),
      };
    case "execute":
    case "create_with_preauthorized_execution":
      return {
        txSig: await processBundledTransaction(
          completeRequest,
          privateKey,
          feePayer,
        ),
      };
    default:
      throw new Error(
        `Unsupported transaction action type: ${transactionActionType}`,
      );
  }
}

async function getTransactionPayload(
  payload: StartCustomTransactionRequest["data"]["payload"],
  signer?: User,
): Promise<{ transactionPayload: TransactionPayloadWithBase64MessageBytes }> {
  if (payload.transactionAddress && payload.transactionActionType) {
    return {
      transactionPayload: payload as TransactionPayloadWithBase64MessageBytes,
    };
  }

  if (!signer?.settingsIndexWithAddress) {
    throw new Error("Signer must be provided for this action.");
  }

  const transactionMessageBytes = new Uint8Array(
    base64URLStringToBuffer(payload.transactionMessageBytes),
  );

  const [settings, settingsAddress] = await Promise.all([
    fetchSettingsAccountData(
      signer.settingsIndexWithAddress.index,
      signer.settingsIndexWithAddress.settingsAddressTreeIndex,
    ),
    getSettingsFromIndex(signer.settingsIndexWithAddress.index),
  ]);

  const txManager = settings.members.find(
    (x) => x.role === UserRole.TransactionManager,
  );

  const signers = [
    simulateSecp256r1Signer(),
    ...(txManager
      ? [createNoopSigner(getAddressDecoder().decode(txManager.pubkey.key))]
      : []),
  ];

  const useBundle = await estimateTransactionSizeExceedLimit({
    signers,
    compressed: settings.isCompressed,
    payer: createNoopSigner(
      getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32))),
    ),
    index: signer.settingsIndexWithAddress.index,
    settingsAddressTreeIndex:
      signer.settingsIndexWithAddress.settingsAddressTreeIndex,
    transactionMessageBytes,
    addressesByLookupTableAddress: getAddressByLookUpTable(),
  });

  return {
    transactionPayload: {
      transactionMessageBytes: payload.transactionMessageBytes,
      transactionActionType: useBundle
        ? txManager
          ? "execute"
          : "create_with_preauthorized_execution"
        : "sync",
      transactionAddress: settingsAddress.toString(),
    },
  };
}
