import {
  bufferToBase64URLString,
  fetchUserAccountData,
  getJitoTipsConfig,
  prepareTransactionSync,
  Secp256r1Key,
  SignedSecp256r1Key,
  type CompleteMessageRequest,
  type CompleteTransactionRequest,
  type SettingsIndexWithAddressArgs,
} from "@revibase/core";
import {
  address,
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
import {
  MAX_TRANSACTION_SIZE_BYTES,
  REVIBASE_LOOKUP_TABLE_ADDRESS,
} from "./consts";

/**
 * Creates a standardized sign-in message text for WebAuthn authentication.
 *
 * @param input - Configuration object containing domain and nonce
 * @returns Formatted sign-in message string
 */
export function createSignInMessageText(input: {
  domain?: string;
  nonce: string;
}): string {
  const message = input.domain
    ? `${input.domain} wants you to sign in with your account.`
    : "Sign in with your account.";

  const fields: string[] = [];

  if (input.nonce) {
    fields.push(`Nonce: ${input.nonce}`);
  }

  return fields.length > 0 ? `${message}\n\n${fields.join("\n")}` : message;
}

/**
 * Retrieves the settings index with address from the request.
 * If not present in additionalInfo, fetches it from the user account data.
 *
 * @param request - Complete message or transaction request
 * @param cachedAccounts - Optional cache for account data to avoid redundant fetches
 * @returns Settings index with address information
 * @throws {Error} If user has no delegated wallet
 */
export async function getSettingsIndexWithAddress(
  request: CompleteMessageRequest | CompleteTransactionRequest,
  cachedAccounts?: Map<string, any>
): Promise<SettingsIndexWithAddressArgs> {
  const { additionalInfo } = request.data.payload;

  if (additionalInfo.settingsIndexWithAddress) {
    return additionalInfo.settingsIndexWithAddress;
  }

  const userAccountData = await fetchUserAccountData(
    new Secp256r1Key(request.data.payload.signer),
    request.data.payload.userAddressTreeIndex,
    cachedAccounts
  );

  if (userAccountData.delegatedTo.__option === "None") {
    throw new Error("User has no delegated wallet");
  }

  return userAccountData.delegatedTo.value;
}

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
            crypto.getRandomValues(new Uint8Array(32))
          ),
          lastValidBlockHeight: BigInt(Number.MAX_SAFE_INTEGER),
        },
        tx
      ),
    (tx) =>
      result.addressesByLookupTableAddress
        ? compressTransactionMessageUsingAddressLookupTables(
            tx,
            result.addressesByLookupTableAddress
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
        tx
      ),

    (tx) => compileTransaction(tx)
  );
  const txSize = getBase64EncodedWireTransaction(tx).length;
  console.log("Estimated Tx Size: ", txSize);
  return txSize > MAX_TRANSACTION_SIZE_BYTES;
}

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
      crypto.getRandomValues(new Uint8Array(32))
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
 * Estimates Jito bundle tip amount based on current network conditions.
 *
 * @param jitoTipsConfig - Optional Jito tips configuration (defaults to global config)
 * @returns Estimated tip amount in lamports
 * @throws {Error} If the API request fails or returns invalid data
 */
export async function estimateJitoTips(
  jitoTipsConfig = getJitoTipsConfig()
): Promise<number> {
  const { getJitoTipsUrl: estimateJitoTipsEndpoint, priority } = jitoTipsConfig;

  const response = await fetch(estimateJitoTipsEndpoint);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Jito tips: ${response.status} ${response.statusText}`
    );
  }

  const result = await response.json();
  if (
    !Array.isArray(result) ||
    !result[0] ||
    typeof result[0][priority] !== "number"
  ) {
    throw new Error("Invalid Jito tips response format");
  }

  const LAMPORTS_PER_SOL = 1_000_000_000;
  return Math.round(result[0][priority] * LAMPORTS_PER_SOL);
}

/**
 * Returns the address lookup table mapping for Revibase.
 * This table contains commonly used program addresses to reduce transaction size.
 *
 * @returns Address lookup table mapping
 */
export function getAddressByLookUpTable(): AddressesByLookupTableAddress {
  return {
    [address(REVIBASE_LOOKUP_TABLE_ADDRESS)]: [
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "11111111111111111111111111111111",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
      "Sysvar1nstructions1111111111111111111111111",
      "auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg",
      "SysvarS1otHashes111111111111111111111111111",
      "3C6AdJiD9qxMqZTmB53b5HC5Yfq2Bb57XAzYDzu4YDcj",
      "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY",
      "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV",
      "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK",
      "GXtd2izAiMJPwMEjfgTRH3d7k9mjn4Jq3JrWFv9gySYy",
      "SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7",
      "35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh",
      "HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA",
      "compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq",
      "bmt1LryLZUMmF7ZtqESaw7wifBXLfXHQYoE4GAmrahU",
      "oq1na8gojfdUhsfCpyjNt6h4JaDWtHf1yQj4koBWfto",
      "cpi15BoVPKgEPw5o8wc2T816GE7b378nMXnhH3Xbq4y",
      "bmt2UxoBxB9xWev4BkLvkGdapsz6sZGkzViPNph7VFi",
      "oq2UkeMsJLfXt2QHzim242SUi3nvjJs8Pn7Eac9H9vg",
      "cpi2yGapXUR3As5SjnHBAVvmApNiLsbeZpF3euWnW6B",
      "bmt3ccLd4bqSVZVeCJnH1F6C8jNygAhaDfxDwePyyGb",
      "oq3AxjekBWgo64gpauB6QtuZNesuv19xrhaC1ZM1THQ",
      "cpi3mbwMpSX8FAGMZVP85AwxqCaQMfEk9Em1v8QK9Rf",
      "bmt4d3p1a4YQgk9PeZv5s4DBUmbF5NxqYpk9HGjQsd8",
      "oq4ypwvVGzCUMoiKKHWh4S1SgZJ9vCvKpcz6RT6A8dq",
      "cpi4yyPDc4bCgHAnsenunGA8Y77j3XEDyjgfyCKgcoc",
      "bmt5yU97jC88YXTuSukYHa8Z5Bi2ZDUtmzfkDTA2mG2",
      "oq5oh5ZR3yGomuQgFduNDzjtGvVWfDRGLuDVjv9a96P",
      "cpi5ZTjdgYpZ1Xr7B1cMLLUE81oTtJbNNAyKary2nV6",
      "amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx",
      "ACXg8a7VaqecBWrSbdu73W4Pg9gsqXJ3EXAqkHyhvVXg",
      "r18WwUxfG8kQ69bQPAB2jV6zGNKy3GosFGctjQoV4ti",
      "cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m",
      "2cLqZJrYMuCzKdSZBoWxZ3tXoeCMmMyDiuy6UBaKnbmK",
      "5tgzUZaVtfnnSEBgmBDtJj6PdgYCnA1uaEGEUi3y5Njg",
      "2yaSthpW4U4VZvBhwPfGA7HwC9v9Rfq3SNRZvJkKcrNe",
    ].map(address),
  };
}
