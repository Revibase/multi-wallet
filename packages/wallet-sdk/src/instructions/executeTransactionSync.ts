import {
  AccountRole,
  type AddressesByLookupTableAddress,
  type Instruction,
  type TransactionSigner,
} from "gill";
import {
  getTransactionExecuteSyncCompressedInstruction,
  getTransactionExecuteSyncInstruction,
  type Secp256r1VerifyArgsWithDomainAddressArgs,
} from "../generated";
import { Secp256r1Key } from "../types";
import { getMultiWalletFromSettings, getSettingsFromIndex } from "../utils";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../utils/compressed/internal";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../utils/internal";
import { accountsForTransactionExecute } from "../utils/transactionMessage/internal";
import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyInput,
} from "./secp256r1Verify";

export async function executeTransactionSync({
  index,
  transactionMessageBytes,
  signers,
  payer,
  addressesByLookupTableAddress,
  secp256r1VerifyInput = [],
  compressed = false,
  simulateProof = false,
  cachedAccounts,
}: {
  index: bigint | number;
  signers: (TransactionSigner | Secp256r1Key)[];
  transactionMessageBytes: Uint8Array;
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  compressed?: boolean;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  payer?: TransactionSigner;
  simulateProof?: boolean;
  cachedAccounts?: Map<string, any>;
}) {
  const dedupSigners = getDeduplicatedSigners(signers);
  const settings = await getSettingsFromIndex(index);
  const multiWallet = await getMultiWalletFromSettings(settings);
  const [
    { accountMetas, addressLookupTableAccounts, transactionMessage },
    { settingsReadonlyArgs, proof, packedAccounts },
  ] = await Promise.all([
    accountsForTransactionExecute({
      transactionMessageBytes,
      multiWallet,
      additionalSigners: dedupSigners.filter(
        (x) => !(x instanceof Secp256r1Key)
      ) as TransactionSigner[],
      addressesByLookupTableAddress,
    }),
    constructSettingsProofArgs(
      compressed,
      index,
      simulateProof,
      cachedAccounts
    ),
  ]);

  packedAccounts.addPreAccounts(accountMetas);

  const secp256r1Signers = dedupSigners.filter(
    (x) => x instanceof Secp256r1Key
  );

  const secp256r1VerifyArgs: Secp256r1VerifyArgsWithDomainAddressArgs[] = [];
  for (const x of secp256r1Signers) {
    const index = secp256r1VerifyInput.length;
    const { domainConfig, verifyArgs, signature, publicKey, message } =
      extractSecp256r1VerificationArgs(x, index);
    if (message && signature && publicKey) {
      secp256r1VerifyInput.push({ message, signature, publicKey });
    }
    if (domainConfig) {
      packedAccounts.addPreAccounts([
        { address: domainConfig, role: AccountRole.READONLY },
      ]);
      if (verifyArgs?.__option === "Some") {
        secp256r1VerifyArgs.push({
          domainConfigKey: domainConfig,
          verifyArgs: verifyArgs.value,
        });
      }
    }
  }

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const instructions: Instruction[] = [];

  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }

  if (compressed) {
    if (!payer || !settingsReadonlyArgs) {
      throw new Error("Payer not found or proof args is missing.");
    }
    const compressedProofArgs = convertToCompressedProofArgs(
      proof,
      systemOffset
    );

    instructions.push(
      getTransactionExecuteSyncCompressedInstruction({
        secp256r1VerifyArgs,
        transactionMessage: {
          ...transactionMessage,
          numAccountKeys: transactionMessage.accountKeys.length,
          instructions: transactionMessage.instructions.map((x) => ({
            programIdIndex: x.programIdIndex,
            accountIndexes: new Uint8Array(x.accountIndexes),
            data: new Uint8Array(x.data),
          })),
          addressTableLookups: transactionMessage.addressTableLookups.map(
            (x) => ({
              accountKeyIndex: accountMetas.findIndex(
                (y) => y.address === x.accountKey
              ),
              writableIndexes: new Uint8Array(x.writableIndexes),
              readonlyIndexes: new Uint8Array(x.readonlyIndexes),
            })
          ),
        },
        settingsReadonly: settingsReadonlyArgs,
        compressedProofArgs,
        payer,
        remainingAccounts,
      })
    );
  } else {
    instructions.push(
      getTransactionExecuteSyncInstruction({
        secp256r1VerifyArgs,
        settings,
        transactionMessage: {
          ...transactionMessage,
          numAccountKeys: transactionMessage.accountKeys.length,
          instructions: transactionMessage.instructions.map((x) => ({
            programIdIndex: x.programIdIndex,
            accountIndexes: new Uint8Array(x.accountIndexes),
            data: new Uint8Array(x.data),
          })),
          addressTableLookups: transactionMessage.addressTableLookups.map(
            (x) => ({
              accountKeyIndex: accountMetas.findIndex(
                (y) => y.address === x.accountKey
              ),
              writableIndexes: new Uint8Array(x.writableIndexes),
              readonlyIndexes: new Uint8Array(x.readonlyIndexes),
            })
          ),
        },
        remainingAccounts,
      })
    );
  }

  return {
    instructions,
    addressLookupTableAccounts,
  };
}
