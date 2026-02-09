import { sha256 } from "@noble/hashes/sha2.js";
import type {
  ExpectedSigner,
  Secp256r1VerifyArgsWithDomainConfigIndex,
} from "@revibase/core";
import {
  createClientAuthorizationStartRequestChallenge,
  getSecp256r1VerifyInstructionDataDecoder,
  getSettingsFromIndex,
  getWalletAddressFromSettings,
  KeyType,
  Secp256r1Key,
  vaultTransactionMessageDeserialize,
  type SettingsMutArgs,
  type SettingsReadonlyArgs,
  type TransactionAuthDetails,
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
  getAddressDecoder,
  type Instruction,
} from "gill";
import type { Secp256r1VerifyData, SignerInfo, VerifiedSigner } from "../types";
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
  secp256r1VerifyArgs: Secp256r1VerifyArgsWithDomainConfigIndex[],
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
        signedMessage.message as Uint8Array,
      ) as Uint8Array<ArrayBuffer>;
      return {
        signer: new Secp256r1Key(signedMessage.publicKey),
        messageHash,
      };
    }),
  );
}

/**
 * Maps expected signers from transaction buffer args to SignerInfo format.
 */
export function mapExpectedSigners(
  expectedSigners: ExpectedSigner[],
): SignerInfo[] {
  return expectedSigners.map((x) => {
    if (x.memberKey.keyType === KeyType.Secp256r1) {
      if (x.messageHash.__option === "None") {
        throw new Error("Message hash cannot be found.");
      }
      return {
        signer: new Secp256r1Key(x.memberKey.key),
        messageHash: x.messageHash.value as Uint8Array<ArrayBuffer>,
      };
    } else {
      return {
        signer: getAddressDecoder().decode(x.memberKey.key),
      };
    }
  });
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

  if (
    signers.filter((x) => x.signer instanceof Secp256r1Key).length !==
    authResponses.length
  ) {
    throw new Error(
      `Signer count mismatch. Expected ${signers.length} auth responses, got ${authResponses.length}`,
    );
  }

  const walletAddress = await getWalletAddressFromSettings(
    address(settingsAddress),
  );
  const verifiedSigners = await Promise.all(
    signers.map(async ({ signer, messageHash }, signerIndex) => {
      if (signer instanceof Secp256r1Key) {
        if (!messageHash) throw new Error("Message hash not found.");
        const authDetails = authResponses[signerIndex];
        const { client, device, authProvider, startRequest } = authDetails;
        if (startRequest.data.type !== "transaction")
          throw new Error("Invalid request type.");
        if (startRequest.validTill < Date.now()) {
          throw new Error("Request has expired.");
        }
        if (startRequest.data.sendTx && !authProvider) {
          throw new Error(
            "Auth provider cannot be empty when send tx is true.",
          );
        }

        const [clientDetails] = await Promise.all([
          verifyClientSignature(
            client,
            startRequest.data.sendTx
              ? createClientAuthorizationStartRequestChallenge(startRequest)
              : messageHash,
            wellKnownProxyUrl,
          ),
          verifyTransactionAuthResponseWithMessageHash(
            authDetails,
            messageHash,
          ),
          verifyAuthProviderSignature(authProvider, messageHash),
          verifyDeviceSignature(device, messageHash),
        ]);
        return {
          signer,
          walletAddress,
          client: { origin: client.clientOrigin, ...clientDetails },
          device: device.jwk,
          authProvider: authProvider?.jwk,
        } as VerifiedSigner;
      }

      return {
        signer,
        walletAddress,
      } as VerifiedSigner;
    }),
  );

  return { instructions, verifiedSigners };
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
  transactionMessage: Uint8Array<ArrayBuffer>,
): Promise<Instruction[]> {
  const compiledMessage =
    vaultTransactionMessageDeserialize(transactionMessage);
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
