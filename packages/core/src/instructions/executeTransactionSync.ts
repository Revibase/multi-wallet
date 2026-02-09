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
import { SignedSecp256r1Key } from "../types";
import { getWalletAddressFromSettings } from "../utils";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../utils/compressed/internal";
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
  cachedAccounts?: Map<string, any>;
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

  const transactionSyncSigners: TransactionSyncSignersArgs[] = [];

  for (const x of dedupSigners) {
    if (x instanceof SignedSecp256r1Key) {
      const index = secp256r1VerifyInput.length;
      const { domainConfig, verifyArgs, signature, publicKey, message } =
        extractSecp256r1VerificationArgs(x, index);

      if (message && signature && publicKey) {
        secp256r1VerifyInput.push({ message, signature, publicKey });
      }
      if (domainConfig) {
        const domainConfigIndex = packedAccounts
          .addPreAccounts([
            { address: domainConfig, role: AccountRole.READONLY },
          ])
          .get(domainConfig)?.index;
        if (verifyArgs.__option === "Some" && domainConfigIndex !== undefined) {
          transactionSyncSigners.push({
            __kind: "Secp256r1",
            fields: [{ domainConfigIndex, verifyArgs: verifyArgs.value }],
          });
        }
      }
    } else {
      const index = packedAccounts
        .addPreAccounts([
          { address: x.address, role: AccountRole.READONLY_SIGNER, signer: x },
        ])
        .get(x.address)?.index;
      if (index !== undefined) {
        transactionSyncSigners.push({
          __kind: "Ed25519",
          fields: [index],
        });
      }
    }
  }

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const instructions: Instruction[] = [];

  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }

  const customTransactionMessage = parseTransactionMessage(
    transactionMessage,
    accountMetas,
  );

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
