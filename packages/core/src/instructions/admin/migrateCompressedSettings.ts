import { type TransactionSigner } from "gill";
import {
  getMigrateCompressedSettingsInstruction,
  type CompressedSettingsData,
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
  index,
  settingsAddressTreeIndex,
}: {
  authority: TransactionSigner;
  args: CompressedSettingsData;
  index: number | bigint;
  settingsAddressTreeIndex?: number;
}) {
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();
  const { address, addressTree } = await getCompressedSettingsAddressFromIndex(
    index,
    settingsAddressTreeIndex,
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
      newAddressParams,
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
