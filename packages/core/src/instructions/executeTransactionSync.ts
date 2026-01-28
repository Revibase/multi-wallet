import type { ValidityProofWithContext } from "@lightprotocol/stateless.js";
import {
  AccountRole,
  type AccountMeta,
  type Address,
  type AddressesByLookupTableAddress,
  type CompiledTransactionMessage,
  type Instruction,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "gill";
import {
  getTransactionExecuteSyncCompressedInstruction,
  getTransactionExecuteSyncInstruction,
  type Secp256r1VerifyArgsWithDomainAddressArgs,
  type SettingsMutArgs,
} from "../generated";
import { SignedSecp256r1Key } from "../types";
import { getSettingsFromIndex, getWalletAddressFromSettings } from "../utils";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../utils/compressed/internal";
import type { PackedAccounts } from "../utils/compressed/packedAccounts";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../utils/transaction/internal";
import { accountsForTransactionExecute } from "../utils/transactionMessage/internal";
import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyInput,
} from "./secp256r1Verify";

export async function executeTransactionSync({
  index,
  settingsAddressTreeIndex,
  transactionMessageBytes,
  signers,
  payer,
  addressesByLookupTableAddress,
  secp256r1VerifyInput = [],
  compressed = false,
  simulateProof = false,
  cachedAccounts,
}: {
  index: number | bigint;
  settingsAddressTreeIndex?: number;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  transactionMessageBytes: ReadonlyUint8Array;
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  compressed?: boolean;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  payer?: TransactionSigner;
  simulateProof?: boolean;
  cachedAccounts?: Map<string, any>;
}) {
  const dedupSigners = getDeduplicatedSigners(signers);
  const settings = await getSettingsFromIndex(index);
  const walletAddress = await getWalletAddressFromSettings(settings);
  const [
    { accountMetas, addressLookupTableAccounts, transactionMessage },
    { settingsMutArgs, proof, packedAccounts },
  ] = await Promise.all([
    accountsForTransactionExecute({
      transactionMessageBytes,
      walletAddress,
      additionalSigners: dedupSigners.filter(
        (x) => !(x instanceof SignedSecp256r1Key),
      ) as TransactionSigner[],
      addressesByLookupTableAddress,
    }),
    constructSettingsProofArgs(
      compressed,
      index,
      settingsAddressTreeIndex,
      simulateProof,
      cachedAccounts,
    ),
  ]);

  packedAccounts.addPreAccounts(accountMetas);

  const secp256r1Signers = dedupSigners.filter(
    (x) => x instanceof SignedSecp256r1Key,
  );

  const { secp256r1VerifyArgs } = await buildSecp256r1VerificationArgs(
    secp256r1Signers,
    secp256r1VerifyInput,
    packedAccounts,
  );

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const instructions = buildTransactionInstructions({
    secp256r1VerifyInput,
    transactionMessage,
    accountMetas,
    compressed,
    payer,
    settingsMutArgs,
    proof,
    systemOffset,
    secp256r1VerifyArgs,
    settings,
    remainingAccounts,
  });

  return {
    instructions,
    addressLookupTableAccounts,
  };
}

/**
 * Builds secp256r1 verification arguments from signers
 */
async function buildSecp256r1VerificationArgs(
  secp256r1Signers: SignedSecp256r1Key[],
  secp256r1VerifyInput: Secp256r1VerifyInput,
  packedAccounts: PackedAccounts,
): Promise<{
  secp256r1VerifyArgs: Secp256r1VerifyArgsWithDomainAddressArgs[];
}> {
  const secp256r1VerifyArgs: Secp256r1VerifyArgsWithDomainAddressArgs[] = [];

  for (const signer of secp256r1Signers) {
    const index = secp256r1VerifyInput.length;
    const { domainConfig, verifyArgs, signature, publicKey, message } =
      await extractSecp256r1VerificationArgs(signer, index);

    if (message && signature && publicKey) {
      secp256r1VerifyInput.push({ message, signature, publicKey });
    }

    if (domainConfig) {
      packedAccounts.addPreAccounts([
        { address: domainConfig, role: AccountRole.READONLY },
      ]);

      if (verifyArgs.__option === "Some") {
        secp256r1VerifyArgs.push({
          domainConfigKey: domainConfig,
          verifyArgs: verifyArgs.value,
        });
      }
    }
  }

  return { secp256r1VerifyArgs };
}

/**
 * Builds transaction instructions based on configuration
 */
function buildTransactionInstructions({
  secp256r1VerifyInput,
  transactionMessage,
  accountMetas,
  compressed,
  payer,
  settingsMutArgs,
  proof,
  systemOffset,
  secp256r1VerifyArgs,
  settings,
  remainingAccounts,
}: {
  secp256r1VerifyInput: Secp256r1VerifyInput;
  transactionMessage: CompiledTransactionMessage;
  accountMetas: AccountMeta[];
  compressed: boolean;
  payer?: TransactionSigner;
  settingsMutArgs: SettingsMutArgs | null;
  proof: ValidityProofWithContext | null;
  systemOffset: number;
  secp256r1VerifyArgs: Secp256r1VerifyArgsWithDomainAddressArgs[];
  settings: Address;
  remainingAccounts: AccountMeta[];
}): Instruction[] {
  const instructions: Instruction[] = [];

  // Add secp256r1 verification instruction if needed
  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }

  const customTransactionMessage = parseTransactionMessage(
    transactionMessage,
    accountMetas,
  );

  // Add transaction execution instruction
  if (compressed) {
    if (!payer || !settingsMutArgs) {
      throw new Error("Payer not found or proof args is missing.");
    }

    const compressedProofArgs = convertToCompressedProofArgs(
      proof,
      systemOffset,
    );

    instructions.push(
      getTransactionExecuteSyncCompressedInstruction({
        secp256r1VerifyArgs,
        transactionMessage: customTransactionMessage,
        settingsMutArgs,
        compressedProofArgs,
        payer,
        remainingAccounts,
      }),
    );
  } else {
    instructions.push(
      getTransactionExecuteSyncInstruction({
        secp256r1VerifyArgs,
        settings,
        transactionMessage: customTransactionMessage,
        remainingAccounts,
      }),
    );
  }

  return instructions;
}

/**
 * Parses a transaction message into the format expected by instructions
 */
function parseTransactionMessage(
  transactionMessage: CompiledTransactionMessage,
  accountMetas: AccountMeta[],
) {
  if (transactionMessage.version === "legacy") {
    throw new Error("Only versioned transaction is allowed.");
  }
  return {
    numSigners: transactionMessage.header.numSignerAccounts,
    numWritableNonSigners:
      transactionMessage.staticAccounts.length -
      transactionMessage.header.numSignerAccounts -
      transactionMessage.header.numReadonlyNonSignerAccounts,
    numWritableSigners:
      transactionMessage.header.numSignerAccounts -
      transactionMessage.header.numReadonlySignerAccounts,
    numAccountKeys: transactionMessage.staticAccounts.length,
    instructions: transactionMessage.instructions.map((x) => ({
      ...x,
      accountIndices: new Uint8Array(x.accountIndices ?? []),
      data: new Uint8Array(x.data ?? []),
    })),
    addressTableLookups:
      transactionMessage.addressTableLookups?.map((x) => ({
        lookupTableAddressIndex: accountMetas.findIndex(
          (y) => y.address === x.lookupTableAddress,
        ),
        writableIndexes: new Uint8Array(x.writableIndexes),
        readonlyIndexes: new Uint8Array(x.readonlyIndexes),
      })) ?? [],
  };
}
