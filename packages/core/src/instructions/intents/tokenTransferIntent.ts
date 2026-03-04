import {
  getBase64Encoder,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "gill";
import {
  getAssociatedTokenAccountAddress,
  getTokenDecoder,
} from "gill/programs";
import { ValidationError } from "../../errors";
import {
  getTokenTransferIntentCompressedInstructionAsync,
  getTokenTransferIntentInstructionAsync,
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

/** Input parameters for token transfer intent */
export type TokenTransferIntentParams = {
  settings: Address;
  settingsAddressTreeIndex?: number;
  destination: Address;
  mint: Address;
  amount: number | bigint;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  tokenProgram: Address;
  payer: TransactionSigner;
  compressed?: boolean;
  cachedAccounts?: AccountCache;
};

export async function tokenTransferIntent({
  settings,
  settingsAddressTreeIndex,
  destination,
  mint,
  signers,
  cachedAccounts,
  amount,
  payer,
  tokenProgram,
  compressed = false,
}: TokenTransferIntentParams): Promise<Instruction[]> {
  const dedupSigners = getDeduplicatedSigners(signers);
  const walletAddress = await getWalletAddressFromSettings(settings);
  const ata = await getAssociatedTokenAccountAddress(
    mint,
    walletAddress,
    tokenProgram,
  );

  const [{ packedAccounts, proof, settingsMutArgs }, { value }] =
    await Promise.all([
      constructSettingsProofArgs(
        compressed,
        settings,
        settingsAddressTreeIndex,
        false,
        cachedAccounts,
      ),
      fetchCachedAccountInfo(ata, cachedAccounts),
    ]);

  const balance = value
    ? getTokenDecoder().decode(getBase64Encoder().encode(value.data[0])).amount
    : 0;
  if (balance < amount) {
    throw new ValidationError("Insufficient balance for token transfer.");
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
      await getTokenTransferIntentCompressedInstructionAsync({
        amount,
        settingsMutArgs,
        compressedProofArgs,
        payer,
        signers: transactionSyncSigners,
        source: walletAddress,
        destination,
        remainingAccounts,
        sourceSplTokenAccount: ata,
        tokenProgram,
        mint,
      }),
    );
  } else {
    instructions.push(
      await getTokenTransferIntentInstructionAsync({
        amount,
        signers: transactionSyncSigners,
        source: walletAddress,
        destination,
        settings,
        remainingAccounts,
        sourceSplTokenAccount: ata,
        tokenProgram,
        mint,
      }),
    );
  }

  return instructions;
}
