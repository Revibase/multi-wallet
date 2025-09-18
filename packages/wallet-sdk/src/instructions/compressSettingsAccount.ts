import { ValidityProofWithContext } from "@lightprotocol/stateless.js";
import { AccountRole, AccountSignerMeta, TransactionSigner } from "@solana/kit";
import {
  CompressedSettings,
  getCompressedSettingsDecoder,
  getCompressSettingsAccountInstruction,
  SettingsCreateOrMutateArgs,
} from "../generated";
import { Secp256r1Key } from "../types";
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
  getNewAddressesParams,
  getValidityProofWithRetry,
} from "../utils/compressed/internal";
import { PackedAccounts } from "../utils/compressed/packedAccounts";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../utils/transactionMessage/internal";
import { getSecp256r1VerifyInstruction } from "./secp256r1Verify";

export async function compressSettingsAccount({
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

  const settings = await getSettingsFromIndex(index);
  const settingsAddress = getCompressedSettingsAddressFromIndex(index);
  const result = await getCompressedAccount(
    settingsAddress,
    cachedCompressedAccounts
  );

  let settingsArg: SettingsCreateOrMutateArgs;
  let proof: ValidityProofWithContext;
  if (!result?.data?.data) {
    const newAddressParams = getNewAddressesParams([
      { pubkey: settingsAddress, type: "Settings" },
    ]);

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
        cachedCompressedAccounts
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
