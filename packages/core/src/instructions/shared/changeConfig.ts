import type { ValidityProofWithContext } from "@lightprotocol/stateless.js";
import { AccountRole, type TransactionSigner } from "gill";
import {
  getChangeConfigCompressedInstruction,
  getChangeConfigInstructionAsync,
  type ConfigAction,
  type Secp256r1VerifyArgsWithDomainAddressArgs,
  type SettingsMutArgs,
} from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import { convertToCompressedProofArgs } from "../../utils/compressed/internal";
import type { PackedAccounts } from "../../utils/compressed/packedAccounts";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../../utils/transaction/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export async function changeConfig({
  signers,
  payer,
  changeConfigArgs,
}: {
  changeConfigArgs: {
    configActions: ConfigAction[];
    index: number | bigint;
    compressed: boolean;
    packedAccounts: PackedAccounts;
    proof: ValidityProofWithContext | null;
    settingsMutArgs: SettingsMutArgs | null;
  };
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  payer: TransactionSigner;
}) {
  const {
    index,
    configActions,
    compressed,
    packedAccounts,
    proof,
    settingsMutArgs,
  } = changeConfigArgs;
  const dedupSigners = getDeduplicatedSigners(signers);
  const transactionSigners = dedupSigners.filter(
    (x) => !(x instanceof SignedSecp256r1Key)
  ) as TransactionSigner[];
  packedAccounts.addPreAccounts(
    transactionSigners.map((x) => ({
      address: x.address,
      role: AccountRole.READONLY_SIGNER,
      signer: x,
    }))
  );
  const secp256r1Signers = dedupSigners.filter(
    (x) => x instanceof SignedSecp256r1Key
  );
  const secp256r1VerifyArgs: Secp256r1VerifyArgsWithDomainAddressArgs[] = [];
  const secp256r1VerifyInput = [];
  for (const x of secp256r1Signers) {
    const index = secp256r1VerifyInput.length;
    const { domainConfig, verifyArgs, signature, publicKey, message } =
      await extractSecp256r1VerificationArgs(x, index);
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
  }

  // 5) Assemble final instructions
  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);
  const instructions = [];
  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }

  if (compressed) {
    if (!settingsMutArgs) {
      throw new Error("Payer not found or proof args is missing.");
    }
    instructions.push(
      getChangeConfigCompressedInstruction({
        configActions,
        payer,
        compressedProofArgs,
        settingsMutArgs,
        remainingAccounts,
        secp256r1VerifyArgs,
      })
    );
  } else {
    instructions.push(
      await getChangeConfigInstructionAsync({
        settingsIndex: index,
        configActions,
        payer,
        compressedProofArgs,
        remainingAccounts,
        secp256r1VerifyArgs,
      })
    );
  }

  return instructions;
}
