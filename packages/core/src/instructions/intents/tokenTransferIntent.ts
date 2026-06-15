import {
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { findAssociatedTokenPda, getTokenDecoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { getTokenTransferIntentInstruction } from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import { getWalletAddressFromSettings } from "../../utils";
import {
  buildSignerAccounts,
  getDeduplicatedSigners,
} from "../../utils/transaction/internal";
import { PackedAccounts } from "../../utils/transaction/packedAccounts";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

/** Input parameters for token transfer intent */
export type TokenTransferIntentParams = {
  settings: Address;
  destination: Address;
  mint: Address;
  amount: number | bigint;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  tokenProgram?: Address;
  payer: TransactionSigner;
};

export async function tokenTransferIntent({
  settings,
  destination,
  mint,
  signers,
  amount,
  payer,
  tokenProgram = TOKEN_PROGRAM_ADDRESS,
}: TokenTransferIntentParams): Promise<Instruction[]> {
  const dedupSigners = getDeduplicatedSigners(signers);
  const walletAddress = await getWalletAddressFromSettings(settings);

  const packedAccounts = new PackedAccounts();

  const { secp256r1VerifyInput, transactionSyncSigners } = buildSignerAccounts(
    dedupSigners,
    packedAccounts,
  );

  const { remainingAccounts } = packedAccounts.toAccountMetas();

  const instructions: Instruction[] = [];
  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }

  instructions.push(
    getTokenTransferIntentInstruction({
      settings,
      payer,
      source: walletAddress,
      sourceSplTokenAccount: (
        await findAssociatedTokenPda({
          mint,
          owner: walletAddress,
          tokenProgram,
        })
      )[0],
      destination,
      destinationSplTokenAccount: (
        await findAssociatedTokenPda({ mint, owner: destination, tokenProgram })
      )[0],
      tokenProgram,
      mint,
      amount,
      signers: transactionSyncSigners,
      remainingAccounts,
    }),
  );

  return instructions;
}
