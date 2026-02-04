import {
  AccountRole,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "gill";
import {
  getNativeTransferIntentCompressedInstruction,
  getNativeTransferIntentInstruction,
  type Secp256r1VerifyArgsWithDomainAddressArgs,
} from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import { getWalletAddressFromSettings } from "../../utils";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
  fetchCachedAccountInfo,
} from "../../utils/compressed/internal";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../../utils/transaction/internal";
import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyInput,
} from "../secp256r1Verify";

export async function nativeTransferIntent({
  settings,
  settingsAddressTreeIndex,
  destination,
  signers,
  cachedAccounts,
  amount,
  payer,
  compressed = false,
}: {
  settings: Address;
  settingsAddressTreeIndex?: number;
  destination: Address;
  amount: number | bigint;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  payer?: TransactionSigner;
  compressed?: boolean;
  cachedAccounts?: Map<string, any>;
}) {
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
    throw new Error("Insufficient balance");
  }

  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  const secp256r1VerifyArgs: Secp256r1VerifyArgsWithDomainAddressArgs[] = [];
  for (const x of dedupSigners) {
    if (x instanceof SignedSecp256r1Key) {
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
        if (verifyArgs.__option === "Some") {
          secp256r1VerifyArgs.push({
            domainConfigKey: domainConfig,
            verifyArgs: verifyArgs.value,
          });
        }
      }
    } else {
      packedAccounts.addPreAccounts([
        { address: x.address, role: AccountRole.READONLY_SIGNER, signer: x },
      ]);
    }
  }

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
        secp256r1VerifyArgs,
        source: walletAddress,
        destination,
        remainingAccounts,
      }),
    );
  } else {
    instructions.push(
      getNativeTransferIntentInstruction({
        amount,
        secp256r1VerifyArgs,
        source: walletAddress,
        destination,
        settings,
        remainingAccounts,
      }),
    );
  }

  return instructions;
}
