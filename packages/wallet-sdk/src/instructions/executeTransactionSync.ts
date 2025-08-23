import { Instruction, TransactionSigner } from "@solana/kit";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../compressed/internal";
import { PackedAccounts } from "../compressed/packedAccounts";
import {
  getTransactionExecuteSyncCompressedInstruction,
  getTransactionExecuteSyncInstruction,
} from "../generated";
import { Secp256r1Key } from "../types";
import { getMultiWalletFromSettings, getSettingsFromIndex } from "../utils";
import {
  accountsForTransactionExecute,
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../utils/internal";
import {
  getSecp256r1VerifyInstruction,
  Secp256r1VerifyInput,
} from "./secp256r1Verify";

export async function executeTransactionSync({
  index,
  transactionMessageBytes,
  signers,
  secp256r1VerifyInput = [],
  compressed = false,
  payer,
}: {
  index: bigint | number;
  signers: (TransactionSigner | Secp256r1Key)[];
  transactionMessageBytes: Uint8Array;
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  compressed?: boolean;
  payer?: TransactionSigner;
}) {
  const dedupSigners = getDeduplicatedSigners(signers);
  const settings = await getSettingsFromIndex(index);
  const multiWallet = await getMultiWalletFromSettings(settings);
  const packedAccounts = new PackedAccounts();

  const [
    { accountMetas, addressLookupTableAccounts, transactionMessage },
    { settingsReadonlyArgs, proof },
  ] = await Promise.all([
    accountsForTransactionExecute({
      transactionMessageBytes,
      multiWallet,
      additionalSigners: dedupSigners.filter(
        (x) => !(x instanceof Secp256r1Key)
      ) as TransactionSigner[],
    }),
    constructSettingsProofArgs(packedAccounts, compressed, index),
  ]);

  packedAccounts.addPreAccounts(accountMetas);

  const {
    slotHashSysvar,
    domainConfig,
    verifyArgs,
    instructionsSysvar,
    signature,
    publicKey,
    message,
  } = extractSecp256r1VerificationArgs(
    dedupSigners.find((x) => x instanceof Secp256r1Key),
    secp256r1VerifyInput.length
  );

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const instructions: Instruction[] = [];

  if (message && signature && publicKey) {
    secp256r1VerifyInput.push({ message, signature, publicKey });
  }

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
        instructionsSysvar,
        domainConfig,
        slotHashSysvar,
        secp256r1VerifyArgs: verifyArgs,
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
        instructionsSysvar,
        domainConfig,
        slotHashSysvar,
        secp256r1VerifyArgs: verifyArgs,
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
