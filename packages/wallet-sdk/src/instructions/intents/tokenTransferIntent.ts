import { fetchToken, findAssociatedTokenPda } from "@solana-program/token-2022";
import {
  AccountRole,
  AccountSignerMeta,
  Address,
  TransactionSigner,
} from "@solana/kit";
import { fetchDelegateIndex } from "../../compressed";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../../compressed/internal";
import { PackedAccounts } from "../../compressed/packedAccounts";
import {
  getTokenTransferIntentCompressedInstructionAsync,
  getTokenTransferIntentInstructionAsync,
} from "../../generated";
import { Secp256r1Key } from "../../types";
import {
  getMultiWalletFromSettings,
  getSettingsFromIndex,
  getSolanaRpc,
} from "../../utils";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../../utils/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export async function tokenTransferIntent({
  creator,
  additionalVoters,
  mint,
  destination,
  tokenProgram,
  amount,
  payer,
  compressed = false,
}: {
  creator: TransactionSigner | Secp256r1Key;
  additionalVoters?: (TransactionSigner | Secp256r1Key)[];
  mint: Address;
  destination: Address;
  tokenProgram: Address;
  amount: number;
  payer?: TransactionSigner;
  compressed?: boolean;
}) {
  const creatorAddress =
    creator instanceof Secp256r1Key ? creator : creator.address;
  const delegateIndex = await fetchDelegateIndex(creatorAddress);
  const settings = await getSettingsFromIndex(delegateIndex);
  const multiWallet = await getMultiWalletFromSettings(settings);

  const [sourceTokenAccount] = await findAssociatedTokenPda({
    owner: multiWallet,
    tokenProgram,
    mint,
  });

  try {
    const token = await fetchToken(getSolanaRpc(), sourceTokenAccount);
    if (token.data.amount < amount) {
      throw new Error(`Insufficient balance.`);
    }
  } catch (error) {
    throw new Error(`Insufficient balance.`);
  }

  const [destinationTokenAccount] = await findAssociatedTokenPda({
    owner: destination,
    tokenProgram,
    mint,
  });

  const signers = getDeduplicatedSigners(
    [creator].concat(additionalVoters ?? [])
  );

  const packedAccounts = new PackedAccounts();

  const signerMetas: AccountSignerMeta[] = signers
    .filter((x): x is TransactionSigner => !(x instanceof Secp256r1Key))
    .map((x) => ({
      address: x.address,
      signer: x,
      role: AccountRole.READONLY_SIGNER,
    }));

  packedAccounts.addPreAccounts(signerMetas);
  const { settingsReadonlyArgs, proof } = await constructSettingsProofArgs(
    packedAccounts,
    compressed,
    delegateIndex
  );
  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const secp256r1Signer = signers.find((x) => x instanceof Secp256r1Key);
  const {
    slotHashSysvar,
    instructionsSysvar,
    domainConfig,
    verifyArgs,
    message,
    signature,
    publicKey,
  } = await extractSecp256r1VerificationArgs(secp256r1Signer);

  const instructions = [];
  if (message && signature && publicKey) {
    instructions.push(
      getSecp256r1VerifyInstruction([{ message, signature, publicKey }])
    );
  }
  if (compressed) {
    if (!settingsReadonlyArgs) {
      throw new Error("Missing proof args.");
    }
    const compressedProofArgs = convertToCompressedProofArgs(
      proof,
      systemOffset
    );
    instructions.push(
      await getTokenTransferIntentCompressedInstructionAsync({
        settingsReadonly: settingsReadonlyArgs,
        source: multiWallet,
        domainConfig,
        sourceTokenAccount,
        destination,
        destinationTokenAccount,
        mint,
        amount,
        secp256r1VerifyArgs: verifyArgs,
        instructionsSysvar,
        slotHashSysvar,
        compressedProofArgs,
        remainingAccounts,
      })
    );
  } else {
    instructions.push(
      await getTokenTransferIntentInstructionAsync({
        source: multiWallet,
        settings,
        domainConfig,
        sourceTokenAccount,
        destination,
        destinationTokenAccount,
        mint,
        amount,
        secp256r1VerifyArgs: verifyArgs,
        instructionsSysvar,
        slotHashSysvar,
        remainingAccounts,
      })
    );
  }

  return instructions;
}
