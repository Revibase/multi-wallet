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
  getNativeTransferIntentCompressedInstruction,
  getNativeTransferIntentInstructionAsync,
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

export async function nativeTransferIntent({
  creator,
  additionalVoters,
  destination,
  amount,
  compressed = false,
}: {
  creator: TransactionSigner | Secp256r1Key;
  additionalVoters?: (TransactionSigner | Secp256r1Key)[];
  destination: Address;
  amount: number;
  compressed?: boolean;
}) {
  const creatorAddress =
    creator instanceof Secp256r1Key ? creator : creator.address;
  const delegateIndex = await fetchDelegateIndex(creatorAddress);
  const settings = await getSettingsFromIndex(delegateIndex);
  const multiWallet = await getMultiWalletFromSettings(settings);

  const lamports =
    (await getSolanaRpc().getAccountInfo(multiWallet).send())?.value
      ?.lamports ?? 0;
  if (lamports < amount) {
    throw new Error(`Insufficient balance.`);
  }

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

  const secp256r1Key = signers.find((x) => x instanceof Secp256r1Key);
  const {
    slotHashSysvar,
    instructionsSysvar,
    domainConfig,
    verifyArgs,
    message,
    signature,
    publicKey,
  } = await extractSecp256r1VerificationArgs(secp256r1Key);

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
      getNativeTransferIntentCompressedInstruction({
        domainConfig,
        destination,
        amount,
        secp256r1VerifyArgs: verifyArgs,
        slotHashSysvar,
        instructionsSysvar,
        settingsReadonly: settingsReadonlyArgs,
        source: multiWallet,
        compressedProofArgs,
        remainingAccounts,
      })
    );
  } else {
    instructions.push(
      await getNativeTransferIntentInstructionAsync({
        source: multiWallet,
        settings,
        domainConfig,
        destination,
        amount,
        secp256r1VerifyArgs: verifyArgs,
        slotHashSysvar,
        instructionsSysvar,
        remainingAccounts,
      })
    );
  }

  return instructions;
}
