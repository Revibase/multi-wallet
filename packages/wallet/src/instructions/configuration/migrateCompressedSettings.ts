import { type TransactionSigner } from "gill";
import {
  getMigrateCompressedSettingsInstruction,
  type CompressedSettingsData,
} from "../../generated";
import { getCompressedSettingsAddressFromIndex } from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountInitArgs,
  getNewAddressesParams,
  getValidityProofWithRetry,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";

export async function migrateSettings({
  args,
  authority,
}: {
  authority: TransactionSigner;
  args: CompressedSettingsData;
}) {
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();

  const newAddressParams = getNewAddressesParams([
    {
      pubkey: getCompressedSettingsAddressFromIndex(args.index),
      type: "Settings",
    },
  ]);
  const proof = await getValidityProofWithRetry([], newAddressParams);
  const settingsCreationArgs = (
    await getCompressedAccountInitArgs(
      packedAccounts,
      proof.treeInfos,
      proof.roots,
      proof.rootIndices,
      newAddressParams
    )
  )[0];

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  return getMigrateCompressedSettingsInstruction({
    compressedProofArgs,
    args,
    authority,
    settingsCreationArgs,
    remainingAccounts,
  });
}
