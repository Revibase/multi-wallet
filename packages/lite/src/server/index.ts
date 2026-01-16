import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
  StartMessageRequest,
  StartTransactionRequest,
  TransactionPayloadWithBase64MessageBytes,
} from "@revibase/core";
import {
  base64URLStringToBuffer,
  createClientAuthorizationStartRequestChallenge,
  fetchSettingsAccountData,
  getSettingsFromIndex,
  UserRole,
} from "@revibase/core";
import {
  createNoopSigner,
  getAddressDecoder,
  getBase58Decoder,
  type TransactionSigner,
} from "gill";
import {
  type StartTransactionRequestWithOptionalType,
  type User,
} from "src/utils";
import {
  createSignInMessageText,
  estimateTransactionSizeExceedLimit,
  getAddressByLookUpTable,
  simulateSecp256r1Signer,
} from "src/utils/internal";
import { processBundledTransaction } from "./processBundledTransaction";
import { processMessage } from "./processMessage";
import { processSyncTransaction } from "./processSyncTransaction";
import { processTokenTransfer } from "./processTokenTransfer";

/**
 * Processes client authorization callbacks for both messages and transactions.
 * Handles the complete authentication and transaction flow.
 *
 * @param request - Start or complete request (message or transaction)
 * @param privateKey - Ed25519 private key for signing
 * @param feePayer - Optional fee payer for transactions
 * @param expectedOrigin - Expected origin for WebAuthn verification
 * @param expectedRPID - Expected RP ID for WebAuthn verification
 * @returns Result containing signature, message, user, or transaction signature
 * @throws {Error} If request phase or type is invalid
 */
export async function processClientAuthCallback(
  request:
    | StartTransactionRequestWithOptionalType
    | StartMessageRequest
    | CompleteTransactionRequest
    | CompleteMessageRequest,
  privateKey: CryptoKey,
  feePayer?: TransactionSigner,
  expectedOrigin?: string,
  expectedRPID?: string
) {
  // Start Request
  if (request.phase === "start") {
    const { data, signer } = request;
    let challenge: Uint8Array;

    if (data.type === "message") {
      const message =
        data.payload ??
        createSignInMessageText({
          nonce: crypto.randomUUID(),
        });
      challenge = createClientAuthorizationStartRequestChallenge({
        ...request,
        signer: getSignerFromRequest(request),
        data: { ...data, payload: message },
      });
      const signature = getBase58Decoder().decode(
        new Uint8Array(
          await crypto.subtle.sign(
            { name: "Ed25519" },
            privateKey,
            new Uint8Array(challenge)
          )
        )
      );
      return { signature, message };
    }

    // Transaction start request
    if (data.type !== "transaction") {
      throw new Error(
        `Unsupported request type: ${(data as { type: string }).type}`
      );
    }

    // Validate that signer is a User object for transaction requests
    if (
      !signer ||
      typeof signer !== "object" ||
      !("settingsIndexWithAddress" in signer)
    ) {
      throw new Error(
        "Transaction start request requires a User signer object"
      );
    }

    const { transactionPayload } = await getTransactionPayload(data, signer);

    const transactionRequest: StartTransactionRequest = {
      phase: "start",
      redirectOrigin: request.redirectOrigin,
      signer: getSignerFromRequest(request),
      data: {
        type: "transaction",
        payload: transactionPayload,
      },
    };

    challenge =
      createClientAuthorizationStartRequestChallenge(transactionRequest);
    const signature = getBase58Decoder().decode(
      new Uint8Array(
        await crypto.subtle.sign(
          { name: "Ed25519" },
          privateKey,
          new Uint8Array(challenge)
        )
      )
    );

    return { signature, transactionPayload };
  }

  // Complete Request
  if (request.data.type === "message") {
    const user = await processMessage(
      { phase: "complete", data: request.data },
      expectedOrigin,
      expectedRPID
    );
    return { user };
  }

  // Transaction complete request
  const { transactionActionType } = request.data.payload.transactionPayload;
  const completeRequest = {
    phase: "complete" as const,
    data: request.data,
  };

  switch (transactionActionType) {
    case "transfer_intent": {
      const txSig = await processTokenTransfer(
        completeRequest,
        privateKey,
        feePayer
      );
      return { txSig };
    }
    case "sync": {
      const txSig = await processSyncTransaction(
        completeRequest,
        privateKey,
        feePayer
      );
      return { txSig };
    }
    case "execute":
    case "create_with_preauthorized_execution": {
      const txSig = await processBundledTransaction(
        completeRequest,
        privateKey,
        feePayer
      );
      return { txSig };
    }
    default:
      throw new Error(
        `Unsupported transaction action type: ${transactionActionType}`
      );
  }
}
function getSignerFromRequest(
  request: StartTransactionRequestWithOptionalType | StartMessageRequest
): string | undefined {
  return request.signer
    ? typeof request.signer === "string"
      ? request.signer
      : request.signer.publicKey
    : undefined;
}

async function getTransactionPayload(
  data: StartTransactionRequestWithOptionalType["data"],
  signer: User
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
      "Invalid transaction payload: transactionMessageBytes is required and must be a string"
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
      base64URLStringToBuffer(payload.transactionMessageBytes)
    );
  } catch (error) {
    throw new Error(
      `Invalid transaction message bytes: ${error instanceof Error ? error.message : "Failed to decode base64"}`
    );
  }

  const [settings, settingsAddress] = await Promise.all([
    fetchSettingsAccountData(
      settingsIndexWithAddress.index,
      settingsIndexWithAddress.settingsAddressTreeIndex
    ),
    getSettingsFromIndex(settingsIndexWithAddress.index),
  ]);

  const txManager = settings.members.find(
    (x) => x.role === UserRole.TransactionManager
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
      getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)))
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
