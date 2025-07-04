import {
  AccountRole,
  Address,
  IAccountSignerMeta,
  TransactionSigner,
} from "@solana/kit";
import { fetchDelegate } from "../../compressed";
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
  const delegateData = await fetchDelegate(creatorAddress);
  const settings = await getSettingsFromIndex(delegateData.index);
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
  const signerMetas: IAccountSignerMeta[] = signers
    .filter((x): x is TransactionSigner => !(x instanceof Secp256r1Key))
    .map((x) => ({
      address: x.address,
      signer: x,
      role: AccountRole.READONLY_SIGNER,
    }));
  packedAccounts.addPreAccounts(signerMetas);
  const { settingsProofArgs, proof } = await constructSettingsProofArgs(
    packedAccounts,
    compressed,
    delegateData.index
  );
  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const secpSigner = signers.find((x) => x instanceof Secp256r1Key);
  const {
    slotHashSysvar,
    instructionsSysvar,
    domainConfig,
    verifyArgs,
    message,
    signature,
    publicKey,
  } = await extractSecp256r1VerificationArgs(secpSigner);

  const instructions = [];
  if (message && signature && publicKey) {
    instructions.push(
      getSecp256r1VerifyInstruction([{ message, signature, publicKey }])
    );
  }

  if (compressed) {
    if (!settingsProofArgs) {
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
        settingsArgs: settingsProofArgs,
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
