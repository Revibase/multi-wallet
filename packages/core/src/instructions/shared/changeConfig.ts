import { AccountRole, type Address, type TransactionSigner } from "gill";
import {
  getChangeConfigInstruction,
  type ConfigAction,
  type TransactionSyncSignersArgs,
} from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../../utils/transaction/internal";
import type { PackedAccounts } from "../../utils/transaction/packedAccounts";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export function changeConfig({
  signers,
  payer,
  changeConfigArgs,
}: {
  changeConfigArgs: {
    configActions: ConfigAction[];
    settings: Address;
    packedAccounts: PackedAccounts;
  };
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  payer: TransactionSigner;
}) {
  const { settings, configActions, packedAccounts } = changeConfigArgs;
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

  const { remainingAccounts } = packedAccounts.toAccountMetas();
  const instructions = [];
  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }

  instructions.push(
    getChangeConfigInstruction({
      settings,
      configActions,
      payer,
      remainingAccounts,
      signers: transactionSyncSigners,
    }),
  );

  return instructions;
}
