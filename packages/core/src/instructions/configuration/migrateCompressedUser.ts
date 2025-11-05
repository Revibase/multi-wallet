import { type TransactionSigner } from "gill";
import {
  getMigrateCompressedUsersInstruction,
  type UserArgs,
} from "../../generated";
import { type UserAccountWithAddressArgs } from "../../types";
import { getUserAccountAddress } from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountInitArgs,
  getValidityProofWithRetry,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";

export async function migrateUsers({
  args,
  authority,
  userAccountArgs,
}: {
  authority: TransactionSigner;
  args: UserArgs;
  userAccountArgs: UserAccountWithAddressArgs;
}) {
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();
  const { address: userAddress, addressTree } =
    await getUserAccountAddress(userAccountArgs);
  const newAddressParams = [
    {
      address: userAddress,
      tree: addressTree,
      queue: addressTree,
      type: "User" as const,
    },
  ];
  const proof = await getValidityProofWithRetry([], newAddressParams);
  const userCreationArgs = (
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

  return getMigrateCompressedUsersInstruction({
    compressedProofArgs,
    args,
    authority,
    userCreationArgs,
    remainingAccounts,
  });
}
