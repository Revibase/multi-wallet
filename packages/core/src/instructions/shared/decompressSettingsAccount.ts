import { AccountRole, type Address, type TransactionSigner } from "gill";
import {
  getDecompressSettingsAccountInstruction,
  type TransactionSyncSignersArgs,
} from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../../utils/compressed/internal";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../../utils/transaction/internal";
import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyInput,
} from "../secp256r1Verify";

export async function decompressSettingsAccount({
  settings,
  settingsAddressTreeIndex,
  payer,
  signers,
  cachedAccounts,
}: {
  settings: Address;
  settingsAddressTreeIndex?: number;
  payer: TransactionSigner;
  signers: (SignedSecp256r1Key | TransactionSigner)[];
  cachedAccounts?: Map<string, any>;
}) {
  const { packedAccounts, proof, settingsMutArgs } =
    await constructSettingsProofArgs(
      true,
      settings,
      settingsAddressTreeIndex,
      false,
      cachedAccounts,
    );

  if (!settingsMutArgs) {
    throw new Error("Proof args is missing");
  }

  const dedupSigners = getDeduplicatedSigners(signers);

  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  const transactionSyncSigners: TransactionSyncSignersArgs[] = [];
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
  instructions.push(
    getDecompressSettingsAccountInstruction({
      settings,
      payer,
      settingsMutArgs,
      compressedProofArgs,
      signers: transactionSyncSigners,
      remainingAccounts,
    }),
  );
  return instructions;
}
