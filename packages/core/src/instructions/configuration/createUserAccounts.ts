import { AccountRole, type TransactionSigner } from "gill";
import {
  getCreateUserAccountsInstructionAsync,
  UserRole,
} from "../../generated";
import { getUserAccountAddress } from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountInitArgs,
  getNewWhitelistedAddressTreeIndex,
  getValidityProofWithRetry,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";

type UserCreationArgs =
  | {
      member: TransactionSigner;
      role: UserRole.TransactionManager;
      transactionManagerUrl: string;
    }
  | {
      member: TransactionSigner;
      role: UserRole.Member | UserRole.PermanentMember;
    };

export async function createUserAccounts({
  createUserArgs,
  payer,
}: {
  payer: TransactionSigner;
  createUserArgs: UserCreationArgs[];
}) {
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();
  packedAccounts.addPreAccounts(
    createUserArgs.map((x) => ({
      address: x.member.address,
      role: AccountRole.READONLY_SIGNER,
      signer: x.member,
    }))
  );

  const userAddressTreeIndex = await getNewWhitelistedAddressTreeIndex();
  const newAddressParams = await Promise.all(
    createUserArgs.map(async (x) => {
      const { address, addressTree } = await getUserAccountAddress(
        x.member.address,
        userAddressTreeIndex
      );
      return {
        address,
        tree: addressTree,
        queue: addressTree,
        type: "User" as const,
      };
    })
  );
  const proof = await getValidityProofWithRetry([], newAddressParams);
  const userCreationArgs = await getCompressedAccountInitArgs(
    packedAccounts,
    proof.treeInfos,
    proof.roots,
    proof.rootIndices,
    newAddressParams
  );

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  return await getCreateUserAccountsInstructionAsync({
    compressedProofArgs,
    payer,
    createUserArgs: createUserArgs.map((x, index) => ({
      member: x.member.address,
      role: x.role,
      userCreationArgs: userCreationArgs[index],
      transactionManagerUrl:
        x.role === UserRole.TransactionManager ? x.transactionManagerUrl : null,
    })),
    remainingAccounts,
  });
}
