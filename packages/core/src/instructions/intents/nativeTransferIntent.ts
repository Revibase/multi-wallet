import { type Address, type Instruction, type TransactionSigner } from "gill";
import { ValidationError } from "../../errors";
import {
  getNativeTransferIntentCompressedInstruction,
  getNativeTransferIntentInstruction,
} from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import type { AccountCache } from "../../types/cache";
import { getWalletAddressFromSettings } from "../../utils";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
  fetchCachedAccountInfo,
} from "../../utils/compressed/internal";
import {
  buildSignerAccounts,
  getDeduplicatedSigners,
} from "../../utils/transaction/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export type NativeTransferIntentParams = {
  settings: Address;
  settingsAddressTreeIndex?: number;
  destination: Address;
  amount: number | bigint;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  payer?: TransactionSigner;
  compressed?: boolean;
  cachedAccounts?: AccountCache;
};

export async function nativeTransferIntent({
  settings,
  settingsAddressTreeIndex,
  destination,
  signers,
  cachedAccounts,
  amount,
  payer,
  compressed = false,
}: NativeTransferIntentParams): Promise<Instruction[]> {
  const dedupSigners = getDeduplicatedSigners(signers);
  const walletAddress = await getWalletAddressFromSettings(settings);

  const [{ packedAccounts, proof, settingsMutArgs }, { value }] =
    await Promise.all([
      constructSettingsProofArgs(
        compressed,
        settings,
        settingsAddressTreeIndex,
        false,
        cachedAccounts,
      ),
      fetchCachedAccountInfo(walletAddress, cachedAccounts),
    ]);

  if ((value?.lamports ?? 0) < BigInt(amount)) {
    throw new ValidationError("Insufficient balance for native transfer.");
  }

  const { secp256r1VerifyInput, transactionSyncSigners } = buildSignerAccounts(
    dedupSigners,
    packedAccounts,
  );

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const instructions: Instruction[] = [];

  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }

  if (compressed) {
    if (!payer || !settingsMutArgs) {
      throw new Error("Payer not found or proof args is missing.");
    }
    const compressedProofArgs = convertToCompressedProofArgs(
      proof,
      systemOffset,
    );
    instructions.push(
      getNativeTransferIntentCompressedInstruction({
        amount,
        settingsMutArgs,
        compressedProofArgs,
        payer,
        signers: transactionSyncSigners,
        source: walletAddress,
        destination,
        remainingAccounts,
      }),
    );
  } else {
    instructions.push(
      getNativeTransferIntentInstruction({
        amount,
        signers: transactionSyncSigners,
        source: walletAddress,
        destination,
        settings,
        remainingAccounts,
      }),
    );
  }

  return instructions;
}
