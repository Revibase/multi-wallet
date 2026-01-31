import {
  bufferToBase64URLString,
  getJitoTipsConfig,
  prepareTransactionSync,
  SignedSecp256r1Key,
} from "@revibase/core";
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  getBlockhashDecoder,
  pipe,
  prependTransactionMessageInstructions,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type AddressesByLookupTableAddress,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "gill";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "gill/programs";
import { MAX_TRANSACTION_SIZE_BYTES } from "./consts.js";

/**
 * Creates a standardized sign-in message text for authentication.
 *
 * The message follows a standard format that includes the domain and nonce
 * for security purposes.
 *
 * @param input - Message parameters
 * @param input.domain - Optional domain name (e.g., "example.com")
 * @param input.nonce - Unique nonce for this authentication attempt
 * @returns Formatted sign-in message string
 */
export function createSignInMessageText(input: {
  domain?: string;
  nonce: string;
}): string {
  let message = "";

  if (input.domain) {
    message += `${input.domain} wants you to sign in with your account.`;
  } else {
    message += `Sign in with your account.`;
  }

  const fields: string[] = [];

  if (input.nonce) {
    fields.push(`Nonce: ${input.nonce}`);
  }
  if (fields.length) {
    message += `\n\n${fields.join("\n")}`;
  }

  return message;
}

/**
 * Creates a simulated Secp256r1 signer for transaction size estimation.
 *
 * This function generates random data to simulate a real signer without
 * requiring actual cryptographic operations. Used for estimating transaction
 * sizes before building the actual transaction.
 *
 * @returns A simulated SignedSecp256r1Key instance
 */
export function simulateSecp256r1Signer() {
  const randomPubkey = crypto.getRandomValues(new Uint8Array(33));
  const authData = crypto.getRandomValues(new Uint8Array(37));
  const clientDataJSON = crypto.getRandomValues(new Uint8Array(250));
  const signature = crypto.getRandomValues(new Uint8Array(64));
  const signer = new SignedSecp256r1Key(randomPubkey, {
    originIndex: 0,
    crossOrigin: false,
    authData,
    domainConfig: getAddressDecoder().decode(
      crypto.getRandomValues(new Uint8Array(32)),
    ),
    signature,
    verifyArgs: {
      slotHash: crypto.getRandomValues(new Uint8Array(32)),
      slotNumber: BigInt(0),
      truncatedClientDataJson: crypto.getRandomValues(new Uint8Array(100)),
      clientDataJson: clientDataJSON,
    },
    clientAndDeviceHash: crypto.getRandomValues(new Uint8Array(32)),
    authResponse: {
      id: "",
      rawId: "",
      type: "public-key",
      clientExtensionResults: {},
      response: {
        authenticatorData: bufferToBase64URLString(authData),
        clientDataJSON: bufferToBase64URLString(clientDataJSON),
        signature: bufferToBase64URLString(signature),
      },
    },
  });
  return signer;
}

/**
 * Estimates whether a transaction will exceed the size limit.
 *
 * This function builds a simulated transaction with the provided parameters
 * and checks if it exceeds the maximum allowed size. This helps determine
 * whether to use a transaction bundle instead of a regular transaction.
 *
 * @param input - Transaction estimation parameters
 * @param input.payer - Transaction signer for paying fees
 * @param input.transactionMessageBytes - Serialized transaction message bytes
 * @param input.index - Settings account index
 * @param input.settingsAddressTreeIndex - Settings address tree index
 * @param input.compressed - Whether the account is compressed
 * @param input.signers - Array of transaction signers
 * @param input.addressesByLookupTableAddress - Optional address lookup tables
 * @param input.cachedAccounts - Optional cache for account data
 * @returns True if the transaction size exceeds the limit, false otherwise
 */
export async function estimateTransactionSizeExceedLimit({
  payer,
  index,
  settingsAddressTreeIndex,
  transactionMessageBytes,
  signers,
  compressed,
  addressesByLookupTableAddress,
  cachedAccounts,
}: {
  payer: TransactionSigner;
  transactionMessageBytes: ReadonlyUint8Array;
  index: number | bigint;
  settingsAddressTreeIndex?: number;
  compressed: boolean;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  cachedAccounts?: Map<string, any>;
}) {
  const result = await prepareTransactionSync({
    payer,
    index,
    settingsAddressTreeIndex,
    transactionMessageBytes,
    signers,
    compressed,
    simulateProof: true,
    addressesByLookupTableAddress,
    cachedAccounts,
  });

  const tx = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => appendTransactionMessageInstructions(result.instructions, tx),
    (tx) => setTransactionMessageFeePayerSigner(result.payer, tx),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: getBlockhashDecoder().decode(
            crypto.getRandomValues(new Uint8Array(32)),
          ),
          lastValidBlockHeight: BigInt(Number.MAX_SAFE_INTEGER),
        },
        tx,
      ),
    (tx) =>
      result.addressesByLookupTableAddress
        ? compressTransactionMessageUsingAddressLookupTables(
            tx,
            result.addressesByLookupTableAddress,
          )
        : tx,
    (tx) =>
      prependTransactionMessageInstructions(
        [
          getSetComputeUnitLimitInstruction({
            units: 800_000,
          }),
          getSetComputeUnitPriceInstruction({
            microLamports: 1000,
          }),
        ],
        tx,
      ),

    (tx) => compileTransaction(tx),
  );
  const txSize = getBase64EncodedWireTransaction(tx).length;

  return txSize > MAX_TRANSACTION_SIZE_BYTES;
}
/**
 * Estimates Jito tip amount for transaction bundles.
 *
 * Fetches current Jito tip recommendations from the configured endpoint
 * and converts the value to lamports.
 *
 * @param jitoTipsConfig - Optional Jito tips configuration (defaults to global config)
 * @returns Estimated tip amount in lamports
 * @throws {Error} If the fetch or parsing fails
 */
export async function estimateJitoTips(
  jitoTipsConfig = getJitoTipsConfig(),
): Promise<number> {
  const { getJitoTipsUrl: estimateJitoTipsEndpoint, priority } = jitoTipsConfig;

  let response: Response;
  try {
    response = await fetch(estimateJitoTipsEndpoint);
    if (!response.ok) {
      throw new Error(`Failed to fetch Jito tips: ${response.statusText}`);
    }
  } catch (error) {
    throw new Error(
      `Network error while fetching Jito tips: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error(
      `Failed to parse Jito tips response: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (
    !Array.isArray(result) ||
    result.length === 0 ||
    !result[0] ||
    typeof result[0] !== "object" ||
    !(priority in result[0]) ||
    typeof result[0][priority] !== "number"
  ) {
    throw new Error("Invalid Jito tips response format");
  }

  const tipAmount = Math.round(result[0][priority] * 10 ** 9);
  return tipAmount;
}
