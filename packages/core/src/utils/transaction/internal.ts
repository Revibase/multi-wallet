import {
  type AccountMeta,
  AccountRole,
  type Address,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getAddressEncoder,
  getBlockhashDecoder,
  type Instruction,
  none,
  type OptionOrNullable,
  pipe,
  prependTransactionMessageInstructions,
  type Rpc,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type SolanaRpcApi,
  some,
  type TransactionSigner,
} from "gill";
import {
  getSetComputeUnitLimitInstruction,
  getTransferSolInstruction,
} from "gill/programs";
import {
  JITO_TIP_ACCOUNTS,
  MIN_COMPUTE_UNITS,
  TRANSACTION_SIZE_LIMIT,
} from "../../constants";
import { BundleError, NetworkError, ValidationError } from "../../errors";
import type { MemberKey, Secp256r1VerifyArgsArgs } from "../../generated";
import {
  KeyType,
  Secp256r1Key,
  SignedSecp256r1Key,
  type TransactionDetails,
} from "../../types";
import { parseJson, validateResponse } from "../async";
import { getSolanaRpc } from "../initialize";
import { getSecp256r1Message } from "../passkeys/internal";
import { retryFetch } from "../retry";
import { requireNonEmpty } from "../validation";

/**
 * Creates an encoded bundle of transactions
 * @param bundle - Array of transaction details with optional compute units
 * @param isSimulate - Whether this is for simulation (uses random blockhash)
 * @returns Array of encoded transactions
 */
export async function createEncodedBundle(
  bundle: (TransactionDetails & { unitsConsumed?: number })[],
  isSimulate = false,
): Promise<any[]> {
  const latestBlockHash = isSimulate
    ? {
        blockhash: getBlockhashDecoder().decode(
          crypto.getRandomValues(new Uint8Array(32)),
        ),
        lastValidBlockHeight: BigInt(Number.MAX_SAFE_INTEGER),
      }
    : (await getSolanaRpc().getLatestBlockhash().send()).value;
  return await Promise.all(
    bundle.map(async (x) => {
      const tx = await pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => appendTransactionMessageInstructions(x.instructions, tx),
        (tx) => setTransactionMessageFeePayerSigner(x.payer, tx),
        (tx) =>
          setTransactionMessageLifetimeUsingBlockhash(latestBlockHash, tx),
        (tx) =>
          x.addressesByLookupTableAddress
            ? compressTransactionMessageUsingAddressLookupTables(
                tx,
                x.addressesByLookupTableAddress,
              )
            : tx,
        async (tx) => {
          const computeUnits = Math.ceil((x.unitsConsumed ?? 0) * 1.1);
          return computeUnits > MIN_COMPUTE_UNITS
            ? prependTransactionMessageInstructions(
                [
                  getSetComputeUnitLimitInstruction({
                    units: computeUnits,
                  }),
                ],
                tx,
              )
            : tx;
        },
        async (tx) =>
          isSimulate
            ? compileTransaction(await tx)
            : await signTransactionMessageWithSigners(await tx),
      );
      return tx;
    }),
  );
}
/**
 * Gets median priority fees for writable accounts
 * @param connection - Solana RPC connection
 * @param accounts - Array of account metadata
 * @returns Median priority fee in microlamports
 */
export async function getMedianPriorityFees(
  connection: Rpc<SolanaRpcApi>,
  accounts: AccountMeta[],
): Promise<number> {
  const recentFees = await connection
    .getRecentPrioritizationFees(
      accounts
        .filter(
          (x) =>
            x.role === AccountRole.WRITABLE ||
            x.role === AccountRole.WRITABLE_SIGNER,
        )
        .map((x) => x.address),
    )
    .send();
  const fees = recentFees.map((f) => Number(f.prioritizationFee));
  fees.sort((a, b) => a - b);
  const mid = Math.floor(fees.length / 2);

  if (fees.length % 2 === 0) {
    return Math.round((fees[mid - 1] + fees[mid]) / 2);
  } else {
    return fees[mid];
  }
}

/**
 * Simulates a bundle of transactions to estimate compute units
 * @param bundle - Array of base64-encoded transaction strings
 * @param connectionUrl - RPC endpoint URL
 * @returns Array of compute units consumed per transaction
 * @throws {ValidationError} If bundle is empty or transactions exceed size limit
 * @throws {NetworkError} If simulation request fails
 * @throws {BundleError} If simulation fails
 */
export async function simulateBundle(
  bundle: string[],
  connectionUrl: string,
): Promise<number[]> {
  requireNonEmpty(bundle, "bundle");

  // Validate transaction sizes
  for (let i = 0; i < bundle.length; i++) {
    if (bundle[i].length > TRANSACTION_SIZE_LIMIT) {
      throw new ValidationError(
        `Transaction ${i} exceeds maximum length of ${TRANSACTION_SIZE_LIMIT} bytes (actual: ${bundle[i].length} bytes)`,
      );
    }
  }

  const response = await retryFetch(() =>
    fetch(connectionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "2",
        method: "simulateBundle",
        params: [
          {
            encodedTransactions: bundle,
          },
          {
            skipSigVerify: true,
            replaceRecentBlockhash: true,
            preExecutionAccountsConfigs: bundle.map(() => ({
              encoding: "base64",
              addresses: [],
            })),
            postExecutionAccountsConfigs: bundle.map(() => ({
              encoding: "base64",
              addresses: [],
            })),
          },
        ],
      }),
    }),
  );

  await validateResponse(response, connectionUrl);
  const data = await parseJson<{
    result?: {
      value: {
        transactionResults: { unitsConsumed: number }[];
        summary:
          | string
          | {
              failed?: {
                error: {
                  TransactionFailure: [unknown, string];
                };
              };
            };
      };
    };
    error?: unknown;
  }>(response);

  if (!data.result || data.error) {
    throw new BundleError(
      `Unable to simulate bundle: ${JSON.stringify(data.error ?? data.result)}`,
    );
  }

  if (
    typeof data.result.value.summary !== "string" &&
    data.result.value.summary.failed
  ) {
    const { TransactionFailure } = data.result.value.summary.failed.error;
    const [, programError] = TransactionFailure;
    throw new BundleError(`Simulation failed: ${programError}`);
  }

  return data.result.value.transactionResults.map((x) => x.unitsConsumed);
}

/**
 * Extracts secp256r1 verification arguments from a signer
 * @param signer - Optional signer (SignedSecp256r1Key or TransactionSigner)
 * @param index - Message index for verification
 * @returns Extracted verification arguments
 */
export function extractSecp256r1VerificationArgs(
  signer?: SignedSecp256r1Key | TransactionSigner,
  index = 0,
) {
  const secp256r1PublicKey =
    signer instanceof SignedSecp256r1Key ? signer : undefined;
  const verifyArgs: OptionOrNullable<Secp256r1VerifyArgsArgs> =
    secp256r1PublicKey?.verifyArgs && index !== -1
      ? some({
          signedMessageIndex: index,
          truncatedClientDataJson:
            secp256r1PublicKey.verifyArgs.truncatedClientDataJson,
          slotNumber: secp256r1PublicKey.verifyArgs.slotNumber,
          originIndex: secp256r1PublicKey.originIndex,
          crossOrigin: secp256r1PublicKey.crossOrigin,
          clientAndDeviceHash: secp256r1PublicKey.clientAndDeviceHash,
        })
      : none();

  const domainConfig = secp256r1PublicKey?.domainConfig
    ? secp256r1PublicKey.domainConfig
    : undefined;
  const signature = secp256r1PublicKey?.verifyArgs
    ? secp256r1PublicKey.signature
    : undefined;
  const message =
    secp256r1PublicKey?.authData && secp256r1PublicKey.verifyArgs.clientDataJson
      ? getSecp256r1Message(secp256r1PublicKey.authResponse)
      : undefined;
  const publicKey = secp256r1PublicKey?.toBuffer();

  return {
    domainConfig,
    verifyArgs,
    signature,
    message,
    publicKey,
  };
}
/**
 * Converts a public key to a member key format
 * @param pubkey - Public key in various formats
 * @returns Member key with key type and encoded key
 */
export function convertPubkeyToMemberkey(
  pubkey: TransactionSigner | Address | Secp256r1Key,
): MemberKey {
  if (pubkey instanceof Secp256r1Key) {
    return { keyType: KeyType.Secp256r1, key: pubkey.toBytes() };
  } else {
    let address;
    try {
      address = "address" in pubkey ? pubkey.address : pubkey;
    } catch {
      address = pubkey as Address;
    }
    return {
      keyType: KeyType.Ed25519,
      key: new Uint8Array([
        0, // pad start with zero to make it 33 bytes
        ...getAddressEncoder().encode(address),
      ]),
    };
  }
}
function getPubkeyString(pubkey: TransactionSigner | SignedSecp256r1Key) {
  if (pubkey instanceof SignedSecp256r1Key) {
    return pubkey.toString();
  } else {
    return pubkey.address.toString();
  }
}
/**
 * Deduplicates signers and validates constraints
 * @param signers - Array of signers to deduplicate
 * @returns Deduplicated array of signers
 * @throws {ValidationError} If more than one Secp256r1 signer is present
 */
export function getDeduplicatedSigners(
  signers: (SignedSecp256r1Key | TransactionSigner)[],
): (SignedSecp256r1Key | TransactionSigner)[] {
  const hashSet = new Set();
  const dedupSigners: (SignedSecp256r1Key | TransactionSigner)[] = [];
  for (const signer of signers) {
    if (!hashSet.has(getPubkeyString(signer))) {
      dedupSigners.push(signer);
      hashSet.add(getPubkeyString(signer));
    }
  }

  // due to current tx size limit (can be removed once tx size limit increases)
  const secp256r1Signers = dedupSigners.filter(
    (x) => x instanceof SignedSecp256r1Key,
  );
  if (secp256r1Signers.length > 1) {
    throw new ValidationError(
      `More than 1 Secp256r1 signers in an instruction is not supported (found ${secp256r1Signers.length})`,
    );
  }
  return dedupSigners;
}

/**
 * Creates a Jito tip instruction
 * @param payer - The transaction signer paying the tip
 * @param tipAmount - Amount in lamports to tip
 * @returns Instruction to transfer SOL to a random Jito tip account
 */
export function addJitoTip({
  payer,
  tipAmount,
}: {
  payer: TransactionSigner;
  tipAmount: number;
}): Instruction {
  const tipAccount =
    JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
  return getTransferSolInstruction({
    source: payer,
    destination: address(tipAccount),
    amount: tipAmount,
  });
}
