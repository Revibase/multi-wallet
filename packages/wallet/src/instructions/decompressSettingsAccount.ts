import {
  AccountRole,
  type AccountSignerMeta,
  type TransactionSigner,
} from "gill";
import {
  type CompressedSettings,
  getCompressedSettingsDecoder,
  getDecompressSettingsAccountInstruction,
  type Secp256r1VerifyArgsWithDomainAddressArgs,
} from "../generated";
import { SignedSecp256r1Key } from "../types";
import {
  getCompressedSettingsAddressFromIndex,
  getSettingsFromIndex,
} from "../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountMutArgs,
  getValidityProofWithRetry,
} from "../utils/compressed/internal";
import { PackedAccounts } from "../utils/compressed/packedAccounts";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../utils/internal";
import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyInput,
} from "./secp256r1Verify";

export async function decompressSettingsAccount({
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

  const hashesWithTree = await getCompressedAccountHashes(
    [
      {
        address: getCompressedSettingsAddressFromIndex(index),
        type: "Settings" as const,
      },
    ],
    cachedAccounts
  );
  const proof = await getValidityProofWithRetry(hashesWithTree, []);
  const settingsMutArgs = getCompressedAccountMutArgs<CompressedSettings>(
    packedAccounts,
    proof.treeInfos,
    proof.leafIndices,
    proof.rootIndices,
    proof.proveByIndices,
    hashesWithTree.filter((x) => x.type === "Settings"),
    getCompressedSettingsDecoder()
  )[0];

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

  const settings = await getSettingsFromIndex(index);
  instructions.push(
    getDecompressSettingsAccountInstruction({
      settings,
      payer,
      settingsMut: settingsMutArgs,
      compressedProofArgs,
      secp256r1VerifyArgs,
      remainingAccounts,
    })
  );
  return instructions;
}
