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
  type TransactionSyncSignersArgs,
} from "../generated";
import { SignedSecp256r1Key, type AccountCache } from "../types";
import { getWalletAddressFromSettings } from "../utils";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../utils/compressed/internal";
import { ValidationError } from "../errors";
import {
  buildSignerAccounts,
  getDeduplicatedSigners,
} from "../utils/transaction/internal";
import { accountsForTransactionExecute } from "../utils/transactionMessage/internal";
import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyInput,
} from "./secp256r1Verify";

export async function executeTransactionSync({
  settings,
  settingsAddressTreeIndex,
  transactionMessageBytes,
  additionalSigners,
  signers,
  payer,
  addressesByLookupTableAddress,
  secp256r1VerifyInput = [],
  compressed = false,
  simulateProof = false,
  cachedAccounts,
}: {
  settings: Address;
  settingsAddressTreeIndex?: number;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  transactionMessageBytes: ReadonlyUint8Array;
  additionalSigners?: TransactionSigner[];
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  compressed?: boolean;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  payer?: TransactionSigner;
  simulateProof?: boolean;
  cachedAccounts?: AccountCache;
}) {
  const dedupSigners = getDeduplicatedSigners(signers);
  const walletAddress = await getWalletAddressFromSettings(settings);
  const [
    { accountMetas, addressLookupTableAccounts, transactionMessage },
    { settingsMutArgs, proof, packedAccounts },
  ] = await Promise.all([
    accountsForTransactionExecute({
      transactionMessageBytes,
      walletAddress,
      additionalSigners,
      addressesByLookupTableAddress,
    }),
    constructSettingsProofArgs(
      compressed,
      settings,
      settingsAddressTreeIndex,
      simulateProof,
      cachedAccounts,
    ),
  ]);

  packedAccounts.addPreAccounts(accountMetas);

  const {
    secp256r1VerifyInput: finalSecp256r1VerifyInput,
    transactionSyncSigners,
  } = buildSignerAccounts(dedupSigners, packedAccounts, secp256r1VerifyInput);

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const instructions: Instruction[] = [];

  if (finalSecp256r1VerifyInput.length > 0) {
    instructions.push(
      getSecp256r1VerifyInstruction(finalSecp256r1VerifyInput),
    );
  }

  const customTransactionMessage = parseTransactionMessage(
    transactionMessage,
    accountMetas,
  );

  if (compressed) {
    if (!payer || !settingsMutArgs) {
      throw new ValidationError(
        "Payer not found or proof args are missing for executeTransactionSync.",
      );
    }

    const compressedProofArgs = convertToCompressedProofArgs(
      proof,
      systemOffset,
    );

    instructions.push(
      getTransactionExecuteSyncCompressedInstruction({
        signers: transactionSyncSigners,
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
        signers: transactionSyncSigners,
        settings,
        transactionMessage: customTransactionMessage,
        remainingAccounts,
      }),
    );
  }

  return {
    instructions,
    addressLookupTableAccounts,
  };
}

function parseTransactionMessage(
  transactionMessage: CompiledTransactionMessage,
  accountMetas: AccountMeta[],
) {
  if (transactionMessage.version === "legacy") {
    throw new ValidationError("Only versioned transaction is allowed.");
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
      data: (x.data ?? []) as Uint8Array,
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
