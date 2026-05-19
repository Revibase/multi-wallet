import { type Address, type Instruction, type TransactionSigner } from "gill";
import { ValidationError } from "../../errors";
import { getNativeTransferIntentInstruction } from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import { getSolanaRpc, getWalletAddressFromSettings } from "../../utils";
import {
  buildSignerAccounts,
  getDeduplicatedSigners,
} from "../../utils/transaction/internal";
import { PackedAccounts } from "../../utils/transaction/packedAccounts";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export type NativeTransferIntentParams = {
  settings: Address;
  destination: Address;
  amount: number | bigint;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
};

export async function nativeTransferIntent({
  settings,
  destination,
  signers,
  amount,
}: NativeTransferIntentParams): Promise<Instruction[]> {
  const dedupSigners = getDeduplicatedSigners(signers);
  const walletAddress = await getWalletAddressFromSettings(settings);

  const { value } = await getSolanaRpc()
    .getAccountInfo(walletAddress, { encoding: "base64" })
    .send();

  if ((value?.lamports ?? 0) < BigInt(amount)) {
    throw new ValidationError("Insufficient balance for native transfer.");
  }
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
    getNativeTransferIntentInstruction({
      amount,
      signers: transactionSyncSigners,
      source: walletAddress,
      destination,
      settings,
      remainingAccounts,
    }),
  );

  return instructions;
}
