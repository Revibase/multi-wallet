import {
  AccountRole,
  IAccountSignerMeta,
  TransactionSigner,
} from "@solana/kit";
import { getCompressedSettingsAddressFromIndex } from "../compressed";
import {
  convertToCompressedProofArgs,
  getCompressedAccountInitArgs,
  getNewAddressesParams,
} from "../compressed/internal";
import { PackedAccounts } from "../compressed/packedAccounts";
import { getCompressSettingsAccountInstruction } from "../generated";
import { Secp256r1Key } from "../types";
import { getLightProtocolRpc, getSettingsFromIndex } from "../utils";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../utils/internal";
import { getSecp256r1VerifyInstruction } from "./secp256r1Verify";

export async function compressSettingsAccount({
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
  const settingsAddress = await getCompressedSettingsAddressFromIndex(index);
  const newAddresses = getNewAddressesParams([
    { pubkey: settingsAddress, type: "Settings" },
  ]);
  const proof = await getLightProtocolRpc().getValidityProofV0(
    [],
    newAddresses
  );
  const settingsCreationArgs = (
    await getCompressedAccountInitArgs(
      packedAccounts,
      proof.treeInfos,
      proof.roots,
      proof.rootIndices,
      newAddresses
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
          } as IAccountSignerMeta)
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
    getCompressSettingsAccountInstruction({
      settings,
      settingsCreationArgs,
      compressedProofArgs,
      payer,
      instructionsSysvar,
      domainConfig,
      slotHashSysvar,
      secp256r1VerifyArgs: verifyArgs,
      remainingAccounts,
    })
  );

  return instructions;
}
