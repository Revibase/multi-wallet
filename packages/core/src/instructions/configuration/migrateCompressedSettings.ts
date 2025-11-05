import { type TransactionSigner } from "gill";
import {
  getMigrateCompressedSettingsInstruction,
  type CompressedSettingsData,
  type SettingsIndexWithAddressArgs,
} from "../../generated";
import { getCompressedSettingsAddressFromIndex } from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountInitArgs,
  getValidityProofWithRetry,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";

export async function migrateSettings({
  args,
  authority,
  settingsIndexWithAddressArgs,
}: {
  authority: TransactionSigner;
  args: CompressedSettingsData;
  settingsIndexWithAddressArgs: SettingsIndexWithAddressArgs;
}) {
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();
  const { address, addressTree } = await getCompressedSettingsAddressFromIndex(
    settingsIndexWithAddressArgs
  );
  const newAddressParams = [
    {
      address,
      tree: addressTree,
      queue: addressTree,
      type: "Settings" as const,
    },
  ];
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
