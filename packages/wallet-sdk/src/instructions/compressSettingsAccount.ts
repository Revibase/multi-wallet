import { ValidityProofWithContext } from "@lightprotocol/stateless.js";
import { AccountRole, AccountSignerMeta, TransactionSigner } from "@solana/kit";
import { getCompressedSettingsAddressFromIndex } from "../compressed";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountInitArgs,
  getCompressedAccountMutArgs,
  getNewAddressesParams,
} from "../compressed/internal";
import { PackedAccounts } from "../compressed/packedAccounts";
import {
  CompressedSettings,
  getCompressedSettingsDecoder,
  getCompressSettingsAccountInstruction,
  SettingsCreateOrMutateArgsArgs,
} from "../generated";
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
  let settingsArg: SettingsCreateOrMutateArgsArgs;
  let proof: ValidityProofWithContext;
  const result =
    await getLightProtocolRpc().getCompressedAccount(settingsAddress);

  if (!result?.data?.data) {
    const newAddressParams = getNewAddressesParams([
      { pubkey: settingsAddress, type: "Settings" },
    ]);

    proof = await getLightProtocolRpc().getValidityProofV0(
      [],
      newAddressParams
    );
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
      const hashesWithTree = await getCompressedAccountHashes([
        { pubkey: settingsAddress, type: "Settings" },
      ]);

      proof = await getLightProtocolRpc().getValidityProofV0(
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
      settingsArg = {
        __kind: "Mutate",
        fields: [settingsMutArgs] as const,
      };
    } else {
      throw new Error("Settings account is already compressed.");
    }
  }

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
    getCompressSettingsAccountInstruction({
      settings,
      settingsArg,
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
