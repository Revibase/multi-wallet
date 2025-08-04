import { AccountRole, AccountSignerMeta, TransactionSigner } from "@solana/kit";
import { getCompressedSettingsAddressFromIndex } from "../compressed";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountMutArgs,
} from "../compressed/internal";
import { PackedAccounts } from "../compressed/packedAccounts";
import {
  CompressedSettings,
  getCompressedSettingsDecoder,
  getDecompressSettingsAccountInstruction,
} from "../generated";
import { Secp256r1Key } from "../types";
import { getLightProtocolRpc, getSettingsFromIndex } from "../utils";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../utils/internal";
import { getSecp256r1VerifyInstruction } from "./secp256r1Verify";

export async function decompressSettingsAccount({
  index,
  payer,
  signers,
}: {
  index: number | bigint;
  payer: TransactionSigner;
  signers: (Secp256r1Key | TransactionSigner)[];
}) {
  const settings = await getSettingsFromIndex(index);
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();

  const hashesWithTree = await getCompressedAccountHashes([
    {
      pubkey: await getCompressedSettingsAddressFromIndex(index),
      type: "Settings" as const,
    },
  ]);
  const proof = await getLightProtocolRpc().getValidityProofV0(
    hashesWithTree,
    []
  );
  const settingsMutArgs = (
    await getCompressedAccountMutArgs<CompressedSettings>(
      packedAccounts,
      proof.treeInfos,
      proof.leafIndices,
      proof.rootIndices,
      proof.proveByIndices,
      hashesWithTree.filter((x) => x.type === "Settings"),
      getCompressedSettingsDecoder()
    )
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
  } = await extractSecp256r1VerificationArgs(
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
