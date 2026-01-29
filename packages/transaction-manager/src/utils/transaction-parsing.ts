import { equalBytes } from "@noble/curves/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  convertMemberKeyToString,
  getSecp256r1VerifyInstructionDataDecoder,
  getSettingsFromIndex,
  getWalletAddressFromSettings,
  Secp256r1Key,
  vaultTransactionMessageDeserialize,
  type ExpectedSecp256r1Signers,
  type Secp256r1VerifyArgsWithDomainAddress,
  type SettingsMutArgs,
  type SettingsReadonlyArgs,
  type TransactionAuthDetails,
  type TransactionBufferCreateArgs,
  type TransactionMessage,
} from "@revibase/core";
import type {
  Address,
  CompiledTransactionMessage,
  CompiledTransactionMessageWithLifetime,
  Rpc,
  SolanaRpcApi,
} from "gill";
import {
  address,
  decompileTransactionMessage,
  fetchAddressesForLookupTables,
  type Instruction,
} from "gill";
import type { Secp256r1VerifyData, SignerInfo } from "../types";
import {
  getRevibaseLookupTableAddresses,
  REVIBASE_LOOKUP_TABLE_ADDRESS,
} from "./consts";
import {
  verifyAuthProviderSignature,
  verifyClientSignature,
  verifyDeviceSignature,
  verifyTransactionAuthResponseWithMessageHash,
} from "./signature-verification";

/**
 * Extracts signer information from secp256r1 verification instructions.
 */
export async function getSecp256r1Signers(
  secp256r1VerifyDataList: Secp256r1VerifyData[] | undefined,
  currentInstructionIndex: number,
  secp256r1VerifyArgs: Array<Secp256r1VerifyArgsWithDomainAddress>,
): Promise<SignerInfo[]> {
  if (!secp256r1VerifyDataList) return [];

  const verificationData = secp256r1VerifyDataList.find(
    (entry) => entry.instructionIndex === currentInstructionIndex - 1,
  )?.data;

  if (!verificationData) return [];

  const { payload: signedMessages } =
    getSecp256r1VerifyInstructionDataDecoder().decode(verificationData);

  return Promise.all(
    secp256r1VerifyArgs.map(async (verifyArg) => {
      const signedMessage =
        signedMessages[verifyArg.verifyArgs.signedMessageIndex];
      const messageHash = sha256(
        new Uint8Array(signedMessage.message),
      ) as Uint8Array<ArrayBuffer>;
      return {
        signer: new Secp256r1Key(
          new Uint8Array(signedMessage.publicKey),
        ).toString(),
        messageHash,
      };
    }),
  );
}

/**
 * Maps expected signers from transaction buffer args to SignerInfo format.
 */
export function mapExpectedSigners(
  expectedSigners: ExpectedSecp256r1Signers[],
): SignerInfo[] {
  return expectedSigners.map((expectedSigner) => ({
    signer: convertMemberKeyToString(expectedSigner.memberKey),
    messageHash: new Uint8Array(expectedSigner.messageHash),
  }));
}

/**
 * Verifies all signatures and returns parsed signer information.
 */
export async function verifyAndParseSigners(
  instructions: Instruction[],
  settingsAddress: string,
  signers: SignerInfo[],
  authResponses?: TransactionAuthDetails[],
  wellKnownProxyUrl?: URL,
) {
  if (!authResponses) {
    throw new Error("Transaction Auth Response is missing");
  }

  if (signers.length !== authResponses.length) {
    throw new Error(
      `Signer count mismatch. Expected ${signers.length} auth responses, got ${authResponses.length}`,
    );
  }

  const walletAddress = await getWalletAddressFromSettings(
    address(settingsAddress),
  );

  const verifiedSigners = await Promise.all(
    signers.map(async ({ signer, messageHash }, signerIndex) => {
      const authDetails = authResponses[signerIndex];
      const { clientSignature, deviceSignature, authProviderSignature } =
        authDetails;

      await Promise.all([
        verifyTransactionAuthResponseWithMessageHash(authDetails, messageHash),
        verifyAuthProviderSignature(authProviderSignature, messageHash),
        verifyClientSignature(clientSignature, messageHash, wellKnownProxyUrl),
        verifyDeviceSignature(deviceSignature, messageHash),
      ]);

      return {
        signer,
        client: clientSignature.clientOrigin,
        device: deviceSignature.publicKey,
        authProvider: authProviderSignature?.publicKey,
        walletAddress,
      };
    }),
  );

  return { instructions, verifiedSigners };
}

/**
 * Verifies that transaction buffer hash matches the provided transaction bytes.
 */
export async function verifyTransactionBufferHash(
  bufferArgs: TransactionBufferCreateArgs,
  transactionMessageBytes: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const computedHash = sha256(transactionMessageBytes);
  return equalBytes(new Uint8Array(bufferArgs.finalBufferHash), computedHash);
}

/**
 * Extracts the settings account address from compressed state arguments.
 */
export async function extractSettingsFromCompressed(
  settingsArgs: SettingsMutArgs | SettingsReadonlyArgs,
  errorMessage: string,
): Promise<string> {
  const settingsOption = settingsArgs?.data?.data;

  if (!settingsOption || settingsOption.__option === "None") {
    throw new Error(errorMessage);
  }

  return getSettingsFromIndex(settingsOption.value.index);
}

/**
 * Parses raw transaction message bytes into decompiled instructions.
 */
export async function parseTransactionMessageBytes(
  rpc: Rpc<SolanaRpcApi>,
  transactionMessageBytes: Uint8Array<ArrayBuffer>,
): Promise<Instruction[]> {
  const compiledMessage = vaultTransactionMessageDeserialize(
    transactionMessageBytes,
  );
  const decompiledMessage =
    await decompileTransactionMessageFetchingLookupTablesWithCache(
      compiledMessage,
      rpc,
    );
  return decompiledMessage.instructions as Instruction[];
}

/**
 * Parses inner transaction instructions from a synchronous execute instruction.
 */
export function parseInnerTransaction(
  outerInstructionAccounts: Instruction["accounts"],
  innerTransactionMessage: TransactionMessage,
): Instruction[] {
  if (!outerInstructionAccounts) {
    throw new Error("Invalid instruction accounts.");
  }

  const accountOffset =
    3 + (innerTransactionMessage.addressTableLookups?.length ?? 0);
  const availableAccounts = outerInstructionAccounts.slice(accountOffset);

  return innerTransactionMessage.instructions.map((compiledInstruction) => ({
    accounts: [...compiledInstruction.accountIndices].map(
      (accountIndex) => availableAccounts[accountIndex],
    ),
    data: compiledInstruction.data,
    programAddress:
      availableAccounts[compiledInstruction.programAddressIndex].address,
  }));
}

/**
 * Decompiles a transaction message, fetching lookup table addresses with caching.
 */
export async function decompileTransactionMessageFetchingLookupTablesWithCache(
  compiledMessage: CompiledTransactionMessage &
    CompiledTransactionMessageWithLifetime,
  rpc: Rpc<SolanaRpcApi>,
) {
  const hasLookupTables =
    "addressTableLookups" in compiledMessage &&
    compiledMessage.addressTableLookups !== undefined &&
    compiledMessage.addressTableLookups.length > 0;

  const lookupTableAddresses = hasLookupTables
    ? compiledMessage.addressTableLookups!.map(
        (lookup) => lookup.lookupTableAddress,
      )
    : [];

  const addressesByLookupTableAddress =
    lookupTableAddresses.length > 0
      ? await fetchAddressesForLookupTablesWithCache(lookupTableAddresses, rpc)
      : {};

  return decompileTransactionMessage(compiledMessage, {
    addressesByLookupTableAddress,
  });
}

async function fetchAddressesForLookupTablesWithCache(
  lookupTableAddresses: Address[],
  rpc: Rpc<SolanaRpcApi>,
) {
  const includesRevibaseLookupTable = lookupTableAddresses.some(
    (tableAddress) => tableAddress.toString() === REVIBASE_LOOKUP_TABLE_ADDRESS,
  );

  if (includesRevibaseLookupTable) {
    const otherLookupTableAddresses = lookupTableAddresses.filter(
      (tableAddress) =>
        tableAddress.toString() !== REVIBASE_LOOKUP_TABLE_ADDRESS,
    );

    return {
      ...getRevibaseLookupTableAddresses(),
      ...(await fetchAddressesForLookupTables(otherLookupTableAddresses, rpc)),
    };
  }

  return fetchAddressesForLookupTables(lookupTableAddresses, rpc);
}
