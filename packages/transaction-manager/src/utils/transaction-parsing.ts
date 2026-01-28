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

async function sha256(
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export async function getSecp256r1Signers(
  secp256r1VerifyDataList: Secp256r1VerifyData[] | undefined,
  currentInstructionIndex: number,
  secp256r1VerifyArgs: Array<Secp256r1VerifyArgsWithDomainAddress>,
): Promise<SignerInfo[]> {
  if (!secp256r1VerifyDataList) {
    return [];
  }

  const verifyData = secp256r1VerifyDataList.find(
    (entry) => entry.instructionIndex === currentInstructionIndex - 1,
  )?.data;

  if (!verifyData) {
    return [];
  }

  const { payload } =
    getSecp256r1VerifyInstructionDataDecoder().decode(verifyData);

  return Promise.all(
    secp256r1VerifyArgs.map(async (verifyArg) => {
      const signedMessage = payload[verifyArg.verifyArgs.signedMessageIndex];
      const messageHash = await sha256(new Uint8Array(signedMessage.message));
      return {
        signer: new Secp256r1Key(
          new Uint8Array(signedMessage.publicKey),
        ).toString(),
        messageHash,
      };
    }),
  );
}

export function mapExpectedSigners(
  expectedSigners: ExpectedSecp256r1Signers[],
): SignerInfo[] {
  return expectedSigners.map((expectedSigner) => ({
    signer: convertMemberKeyToString(expectedSigner.memberKey),
    messageHash: new Uint8Array(expectedSigner.messageHash),
  }));
}

export async function verifyAndParseSigners(
  instructions: Instruction[],
  settingsAddress: string,
  signers: SignerInfo[],
  authResponses?: TransactionAuthDetails[],
) {
  if (!authResponses) {
    throw new Error("Transaction Auth Response is missing");
  }

  if (signers.length !== authResponses.length) {
    throw new Error("Signer and auth response length mismatch");
  }
  const walletAddress = await getWalletAddressFromSettings(
    address(settingsAddress),
  );

  const verifiedSigners = await Promise.all(
    signers.map(async ({ signer, messageHash }, index) => {
      const authDetails = authResponses[index];
      const { clientSignature, deviceSignature, authProviderSignature } =
        authDetails;

      await Promise.all([
        verifyTransactionAuthResponseWithMessageHash(authDetails, messageHash),
        verifyAuthProviderSignature(authProviderSignature, messageHash),
        verifyClientSignature(clientSignature, messageHash),
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

  return {
    instructions,
    verifiedSigners,
  };
}

export async function verifyTransactionBufferHash(
  args: TransactionBufferCreateArgs,
  transactionMessageBytes: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const computedHash = await sha256(transactionMessageBytes);
  return bytesEqual(new Uint8Array(args.finalBufferHash), computedHash);
}

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

export async function parseTransactionMessageBytes(
  rpc: Rpc<SolanaRpcApi>,
  transactionMessageBytes: Uint8Array,
): Promise<Instruction[]> {
  const compiledMessage = vaultTransactionMessageDeserialize(
    transactionMessageBytes,
  );
  const decompiled =
    await decompileTransactionMessageFetchingLookupTablesWithCache(
      compiledMessage,
      rpc,
    );
  return decompiled.instructions as Instruction[];
}

export function parseInnerTransaction(
  accounts: Instruction["accounts"],
  compiledMessage: TransactionMessage,
): Instruction[] {
  if (!accounts) {
    throw new Error("Invalid instruction accounts.");
  }

  const accountOffset = 3 + (compiledMessage.addressTableLookups?.length ?? 0);
  const availableAccounts = accounts.slice(accountOffset);

  return compiledMessage.instructions.map((compiledInstruction) => ({
    accounts: [...compiledInstruction.accountIndices].map(
      (accountIndex) => availableAccounts[accountIndex],
    ),
    data: compiledInstruction.data,
    programAddress:
      availableAccounts[compiledInstruction.programAddressIndex].address,
  }));
}

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
    const otherLookupTables = lookupTableAddresses.filter(
      (tableAddress) =>
        tableAddress.toString() !== REVIBASE_LOOKUP_TABLE_ADDRESS,
    );

    return {
      ...getRevibaseLookupTableAddresses(),
      ...(await fetchAddressesForLookupTables(otherLookupTables, rpc)),
    };
  }

  return fetchAddressesForLookupTables(lookupTableAddresses, rpc);
}
