import type { ValidityProofWithContext } from "@lightprotocol/stateless.js";
import { AccountRole, type Address, type TransactionSigner } from "gill";
import {
  getChangeConfigCompressedInstruction,
  getChangeConfigInstruction,
  type ConfigAction,
  type SettingsMutArgs,
  type TransactionSyncSignersArgs,
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
    settings: Address;
    compressed: boolean;
    packedAccounts: PackedAccounts;
    proof: ValidityProofWithContext | null;
    settingsMutArgs: SettingsMutArgs | null;
  };
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  payer: TransactionSigner;
}) {
  const {
    settings,
    configActions,
    compressed,
    packedAccounts,
    proof,
    settingsMutArgs,
  } = changeConfigArgs;
  const dedupSigners = getDeduplicatedSigners(signers);
  const transactionSyncSigners: TransactionSyncSignersArgs[] = [];
  const secp256r1VerifyInput = [];
  for (const x of dedupSigners) {
    if (x instanceof SignedSecp256r1Key) {
      const index = secp256r1VerifyInput.length;
      const { domainConfig, verifyArgs, signature, publicKey, message } =
        extractSecp256r1VerificationArgs(x, index);
      if (message && signature && publicKey) {
        secp256r1VerifyInput.push({ message, signature, publicKey });
      }
      if (domainConfig) {
        const domainConfigIndex = packedAccounts
          .addPreAccounts([
            { address: domainConfig, role: AccountRole.READONLY },
          ])
          .get(domainConfig)?.index;
        if (verifyArgs.__option === "Some" && domainConfigIndex !== undefined) {
          transactionSyncSigners.push({
            __kind: "Secp256r1",
            fields: [{ domainConfigIndex, verifyArgs: verifyArgs.value }],
          });
        }
      }
    } else {
      const index = packedAccounts
        .addPreAccounts([
          { address: x.address, role: AccountRole.READONLY_SIGNER, signer: x },
        ])
        .get(x.address)?.index;

      if (index !== undefined) {
        transactionSyncSigners.push({
          __kind: "Ed25519",
          fields: [index],
        });
      }
    }
  }

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
        signers: transactionSyncSigners,
      }),
    );
  } else {
    instructions.push(
      getChangeConfigInstruction({
        settings,
        configActions,
        payer,
        compressedProofArgs,
        remainingAccounts,
        signers: transactionSyncSigners,
      }),
    );
  }

  return instructions;
}
