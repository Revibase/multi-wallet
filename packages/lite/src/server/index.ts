import type {
  StartMessageRequest,
  StartTransactionRequest,
  TransactionPayloadWithBase64MessageBytes,
} from "@revibase/core";
import {
  base64URLStringToBuffer,
  fetchSettingsAccountData,
  getSettingsFromIndex,
  StartMessageRequestSchema,
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
  StartTransactionRequestWithOptionalTypeSchema,
  type CompleteMessageRequest,
  type CompleteTransactionRequest,
  type StartTransactionRequestWithOptionalType,
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
 * @param providerOrigin - Auth Provider origin for WebAuthn verification
 * @param rpId - Auth Provider RP ID for WebAuthn verification
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
    | StartTransactionRequestWithOptionalType
    | StartMessageRequest
    | CompleteMessageRequest
    | CompleteTransactionRequest;
  privateKey: CryptoKey;
  feePayer?: TransactionSigner;
  providerOrigin?: string;
  rpId?: string;
}) {
  const parsedResult = z
    .union([
      StartTransactionRequestWithOptionalTypeSchema,
      StartMessageRequestSchema,
      CompleteTransactionRequestSchema,
      CompleteMessageRequestSchema,
    ])
    .parse(request);

  if (parsedResult.phase === "start") {
    const { data, signer } = parsedResult;
    if (data.type === "message") {
      const message =
        data.payload ??
        createSignInMessageText({
          nonce: crypto.randomUUID(),
        });
      const messageRequest: StartMessageRequest = {
        ...parsedResult,
        signer: getSignerFromRequest(parsedResult),
        data: { ...data, payload: message },
      };
      return await processStartRequest({
        request: messageRequest,
        privateKey,
        providerOrigin,
      });
    }

    if (data.type !== "transaction") {
      throw new Error(
        `Unsupported request type: ${(data as { type: string }).type}`,
      );
    }

    if (
      !signer ||
      typeof signer !== "object" ||
      !("settingsIndexWithAddress" in signer)
    ) {
      throw new Error(
        "Transaction start request requires a User signer object",
      );
    }

    const { transactionPayload } = await getTransactionPayload(data, signer);

    const transactionRequest: StartTransactionRequest = {
      phase: "start",
      redirectOrigin: parsedResult.redirectOrigin,
      signer: getSignerFromRequest(parsedResult),
      data: {
        type: "transaction",
        payload: transactionPayload,
      },
    };

    return await processStartRequest({
      request: transactionRequest,
      providerOrigin,
      privateKey,
    });
  }

  const result = await processGetResult({
    rid: parsedResult.data.rid,
    providerOrigin,
    privateKey,
  });

  if (result.data.type === "message") {
    const user = await processMessage(
      { phase: "complete", data: result.data },
      providerOrigin,
      rpId,
    );
    return { user };
  }

  const { transactionActionType } = result.data.payload.transactionPayload;
  const completeRequest = {
    phase: "complete" as const,
    data: result.data,
  };

  switch (transactionActionType) {
    case "transfer_intent": {
      const txSig = await processTokenTransfer(
        completeRequest,
        privateKey,
        feePayer,
      );
      return { txSig };
    }
    case "sync": {
      const txSig = await processSyncTransaction(
        completeRequest,
        privateKey,
        feePayer,
      );
      return { txSig };
    }
    case "execute":
    case "create_with_preauthorized_execution": {
      const txSig = await processBundledTransaction(
        completeRequest,
        privateKey,
        feePayer,
      );
      return { txSig };
    }
    default:
      throw new Error(
        `Unsupported transaction action type: ${transactionActionType}`,
      );
  }
}

function getSignerFromRequest(
  request: StartTransactionRequestWithOptionalType | StartMessageRequest,
): string | undefined {
  return request.signer
    ? typeof request.signer === "string"
      ? request.signer
      : request.signer.publicKey
    : undefined;
}

async function getTransactionPayload(
  data: StartTransactionRequestWithOptionalType["data"],
  signer: User,
): Promise<{ transactionPayload: TransactionPayloadWithBase64MessageBytes }> {
  // Validate payload structure
  if (!data.payload || typeof data.payload !== "object") {
    throw new Error("Invalid transaction payload: payload must be an object");
  }

  if (
    !data.payload.transactionMessageBytes ||
    typeof data.payload.transactionMessageBytes !== "string"
  ) {
    throw new Error(
      "Invalid transaction payload: transactionMessageBytes is required and must be a string",
    );
  }

  // If both transactionAddress and transactionActionType are provided, use them directly
  if (data.payload.transactionAddress && data.payload.transactionActionType) {
    return {
      transactionPayload:
        data.payload as TransactionPayloadWithBase64MessageBytes,
    };
  }

  // Validate signer has required properties
  if (
    !signer.settingsIndexWithAddress ||
    typeof signer.settingsIndexWithAddress !== "object"
  ) {
    throw new Error("Invalid signer: settingsIndexWithAddress is required");
  }

  const payload = data.payload;
  const settingsIndexWithAddress = signer.settingsIndexWithAddress;

  // Decode base64 transaction message bytes to Uint8Array
  let transactionMessageBytes: Uint8Array;
  try {
    transactionMessageBytes = new Uint8Array(
      base64URLStringToBuffer(payload.transactionMessageBytes),
    );
  } catch (error) {
    throw new Error(
      `Invalid transaction message bytes: ${error instanceof Error ? error.message : "Failed to decode base64"}`,
    );
  }

  const [settings, settingsAddress] = await Promise.all([
    fetchSettingsAccountData(
      settingsIndexWithAddress.index,
      settingsIndexWithAddress.settingsAddressTreeIndex,
    ),
    getSettingsFromIndex(settingsIndexWithAddress.index),
  ]);

  const txManager = settings.members.find(
    (x) => x.role === UserRole.TransactionManager,
  );

  const useBundle = await estimateTransactionSizeExceedLimit({
    signers: [
      simulateSecp256r1Signer(),
      ...(txManager
        ? [createNoopSigner(getAddressDecoder().decode(txManager.pubkey.key))]
        : []),
    ],
    compressed: settings.isCompressed,
    payer: createNoopSigner(
      getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32))),
    ),
    index: settingsIndexWithAddress.index,
    settingsAddressTreeIndex: settingsIndexWithAddress.settingsAddressTreeIndex,
    transactionMessageBytes,
    addressesByLookupTableAddress: getAddressByLookUpTable(),
  });

  const transactionActionType = useBundle
    ? txManager
      ? "execute"
      : "create_with_preauthorized_execution"
    : "sync";

  const transactionPayload: TransactionPayloadWithBase64MessageBytes = {
    transactionMessageBytes: payload.transactionMessageBytes,
    transactionActionType,
    transactionAddress: settingsAddress.toString(),
  };
  return { transactionPayload };
}
