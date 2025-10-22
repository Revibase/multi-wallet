import type { TransactionSigner } from "gill";
import {
  getEditTransactionManagerUrlInstruction,
  getUserDecoder,
  type User,
} from "../../generated";
import { getUserAccountAddress } from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountMutArgs,
  getValidityProofWithRetry,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";

export async function editTransactionManagerUrl({
  authority,
  transactionManagerUrl,
}: {
  authority: TransactionSigner;
  transactionManagerUrl: string;
}) {
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();
  const hashesWithTree = await getCompressedAccountHashes([
    { address: getUserAccountAddress(authority.address), type: "User" },
  ]);
  const proof = await getValidityProofWithRetry(hashesWithTree, []);
  const userMutArgs = getCompressedAccountMutArgs<User>(
    packedAccounts,
    proof.treeInfos,
    proof.leafIndices,
    proof.rootIndices,
    proof.proveByIndices,
    hashesWithTree,
    getUserDecoder()
  )[0];
  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);
  return getEditTransactionManagerUrlInstruction({
    authority,
    transactionManagerUrl,
    compressedProofArgs,
    userMutArgs,
    remainingAccounts,
  });
}
