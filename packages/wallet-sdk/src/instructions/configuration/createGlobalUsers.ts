import { AccountRole, type TransactionSigner } from "gill";
import { getCreateGlobalUsersInstruction } from "../../generated";
import { getUserAddress, getUserExtensionsAddress } from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountInitArgs,
  getNewAddressesParams,
  getValidityProofWithRetry,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";

type UserCreationArgs =
  | {
      member: TransactionSigner;
      isPermanentMember: boolean;
      apiUrl: undefined;
    }
  | {
      member: TransactionSigner;
      isPermanentMember: false;
      apiUrl: string;
    };

export async function createGlobalUsers({
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
  const newAddressParams = getNewAddressesParams(
    createUserArgs.map((x) => ({
      pubkey: getUserAddress(x.member.address),
      type: "User",
    }))
  );
  const proof = await getValidityProofWithRetry([], newAddressParams);
  const userCreationArgs = await getCompressedAccountInitArgs(
    packedAccounts,
    proof.treeInfos,
    proof.roots,
    proof.rootIndices,
    newAddressParams
  );

  packedAccounts.addPreAccounts(
    await Promise.all(
      createUserArgs
        .filter((x) => !!x.apiUrl)
        .map(async (x) => ({
          address: await getUserExtensionsAddress(x.member.address),
          role: AccountRole.WRITABLE,
        }))
    )
  );

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  return getCreateGlobalUsersInstruction({
    compressedProofArgs,
    payer,
    createUserArgs: createUserArgs.map((x, index) => ({
      member: x.member.address,
      isPermanentMember: x.isPermanentMember,
      userCreationArgs: userCreationArgs[index],
      apiUrl: x.apiUrl ?? null,
    })),
    remainingAccounts,
  });
}
