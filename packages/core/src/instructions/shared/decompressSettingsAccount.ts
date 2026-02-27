import { type Address, type TransactionSigner } from "gill";
import {
  getDecompressSettingsAccountInstruction,
  type TransactionSyncSignersArgs,
} from "../../generated";
import { SignedSecp256r1Key, type AccountCache } from "../../types";
import { ValidationError } from "../../errors";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../../utils/compressed/internal";
import {
  buildSignerAccounts,
  getDeduplicatedSigners,
} from "../../utils/transaction/internal";
import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyInput,
} from "../secp256r1Verify";

export async function decompressSettingsAccount({
  settings,
  settingsAddressTreeIndex,
  payer,
  signers,
  cachedAccounts,
}: {
  settings: Address;
  settingsAddressTreeIndex?: number;
  payer: TransactionSigner;
  signers: (SignedSecp256r1Key | TransactionSigner)[];
  cachedAccounts?: AccountCache;
}) {
  const { packedAccounts, proof, settingsMutArgs } =
    await constructSettingsProofArgs(
      true,
      settings,
      settingsAddressTreeIndex,
      false,
      cachedAccounts,
    );

  if (!settingsMutArgs) {
    throw new ValidationError("Proof args are missing for settings account.");
  }

  const dedupSigners = getDeduplicatedSigners(signers);

  const {
    secp256r1VerifyInput,
    transactionSyncSigners,
  }: {
    secp256r1VerifyInput: Secp256r1VerifyInput;
    transactionSyncSigners: TransactionSyncSignersArgs[];
  } = buildSignerAccounts(dedupSigners, packedAccounts);

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);
  const instructions = [];
  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }
  instructions.push(
    getDecompressSettingsAccountInstruction({
      settings,
      payer,
      settingsMutArgs,
      compressedProofArgs,
      signers: transactionSyncSigners,
      remainingAccounts,
    }),
  );
  return instructions;
}
