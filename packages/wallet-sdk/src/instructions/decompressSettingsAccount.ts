import { AccountRole, AccountSignerMeta, TransactionSigner } from "@solana/kit";
import {
  CompressedSettings,
  getCompressedSettingsDecoder,
  getDecompressSettingsAccountInstruction,
} from "../generated";
import { Secp256r1Key } from "../types";
import {
  getCompressedSettingsAddressFromIndex,
  getLightProtocolRpc,
  getSettingsFromIndex,
} from "../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountMutArgs,
} from "../utils/compressed/internal";
import { PackedAccounts } from "../utils/compressed/packedAccounts";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../utils/transactionMessage/internal";
import { getSecp256r1VerifyInstruction } from "./secp256r1Verify";

export async function decompressSettingsAccount({
  index,
  payer,
  signers,
  cachedCompressedAccounts,
}: {
  index: number | bigint;
  payer: TransactionSigner;
  signers: (Secp256r1Key | TransactionSigner)[];
  cachedCompressedAccounts?: Map<string, any>;
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
    cachedCompressedAccounts
  );
  const proof = await getLightProtocolRpc().getValidityProofV0(
    hashesWithTree,
    []
  );
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
  const {
    slotHashSysvar,
    domainConfig,
    verifyArgs,
    instructionsSysvar,
    signature,
    publicKey,
    message,
  } = extractSecp256r1VerificationArgs(
    dedupSigners.find((x) => x instanceof Secp256r1Key)
  );
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
  if (message && signature && publicKey) {
    instructions.push(
      getSecp256r1VerifyInstruction([{ message, signature, publicKey }])
    );
  }
  const settings = await getSettingsFromIndex(index);
  instructions.push(
    getDecompressSettingsAccountInstruction({
      settings,
      payer,
      settingsMut: settingsMutArgs,
      compressedProofArgs,
      instructionsSysvar,
      domainConfig,
      slotHashSysvar,
      secp256r1VerifyArgs: verifyArgs,
      remainingAccounts,
    })
  );
  return instructions;
}
