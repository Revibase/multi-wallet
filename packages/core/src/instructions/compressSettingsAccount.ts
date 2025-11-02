import type { ValidityProofWithContext } from "@lightprotocol/stateless.js";
import {
  AccountRole,
  type AccountSignerMeta,
  type TransactionSigner,
} from "gill";
import {
  type CompressedSettings,
  getCompressedSettingsDecoder,
  getCompressSettingsAccountInstruction,
  type Secp256r1VerifyArgsWithDomainAddressArgs,
  type SettingsCreateOrMutateArgs,
} from "../generated";
import { SignedSecp256r1Key } from "../types";
import {
  getCompressedSettingsAddressFromIndex,
  getSettingsFromIndex,
} from "../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccount,
  getCompressedAccountHashes,
  getCompressedAccountInitArgs,
  getCompressedAccountMutArgs,
  getValidityProofWithRetry,
} from "../utils/compressed/internal";
import { PackedAccounts } from "../utils/compressed/packedAccounts";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../utils/transaction/internal";
import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyInput,
} from "./secp256r1Verify";

export async function compressSettingsAccount({
  index,
  payer,
  signers,
  cachedAccounts,
}: {
  index: number | bigint;
  payer: TransactionSigner;
  signers: (SignedSecp256r1Key | TransactionSigner)[];
  cachedAccounts?: Map<string, any>;
}) {
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();

  const settings = await getSettingsFromIndex(index);
  const { address: settingsAddress, addressTree } =
    getCompressedSettingsAddressFromIndex(index);
  const result = await getCompressedAccount(settingsAddress, cachedAccounts);

  let settingsArg: SettingsCreateOrMutateArgs;
  let proof: ValidityProofWithContext;
  if (!result?.data?.data) {
    const newAddressParams = [
      {
        address: settingsAddress,
        tree: addressTree,
        queue: addressTree,
        type: "Settings" as const,
      },
    ];

    proof = await getValidityProofWithRetry([], newAddressParams);
    const settingsInitArgs = (
      await getCompressedAccountInitArgs(
        packedAccounts,
        proof.treeInfos,
        proof.roots,
        proof.rootIndices,
        newAddressParams
      )
    )[0];
    settingsArg = {
      __kind: "Create",
      fields: [settingsInitArgs] as const,
    };
  } else {
    const data = getCompressedSettingsDecoder().decode(result.data.data);
    if (data.data.__option === "None") {
      const hashesWithTree = await getCompressedAccountHashes(
        [{ address: settingsAddress, type: "Settings" }],
        cachedAccounts
      );

      proof = await getValidityProofWithRetry(hashesWithTree, []);
      const settingsMutArgs = getCompressedAccountMutArgs<CompressedSettings>(
        packedAccounts,
        proof.treeInfos,
        proof.leafIndices,
        proof.rootIndices,
        proof.proveByIndices,
        hashesWithTree.filter((x) => x.type === "Settings"),
        getCompressedSettingsDecoder()
      )[0];
      settingsArg = {
        __kind: "Mutate",
        fields: [settingsMutArgs] as const,
      };
    } else {
      throw new Error("Settings account is already compressed.");
    }
  }

  const dedupSigners = getDeduplicatedSigners(signers);

  const secp256r1Signers = dedupSigners.filter(
    (x) => x instanceof SignedSecp256r1Key
  );

  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  const secp256r1VerifyArgs: Secp256r1VerifyArgsWithDomainAddressArgs[] = [];
  for (const x of secp256r1Signers) {
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
      if (verifyArgs?.__option === "Some") {
        secp256r1VerifyArgs.push({
          domainConfigKey: domainConfig,
          verifyArgs: verifyArgs.value,
        });
      }
    }
  }

  packedAccounts.addPreAccounts(
    dedupSigners
      .filter((x) => "address" in x)
      .map(
        (x) =>
          ({
            address: x.address,
            role: AccountRole.READONLY_SIGNER,
            signer: x,
          }) as AccountSignerMeta
      )
  );

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  const instructions = [];
  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }
  instructions.push(
    getCompressSettingsAccountInstruction({
      settings,
      settingsArg,
      compressedProofArgs,
      payer,
      secp256r1VerifyArgs,
      remainingAccounts,
    })
  );

  return instructions;
}
