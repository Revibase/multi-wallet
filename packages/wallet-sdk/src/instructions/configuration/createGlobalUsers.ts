import { AccountRole, TransactionSigner } from "@solana/kit";
import { getCreateGlobalUsersInstruction } from "../../generated";
import { getLightProtocolRpc, getUserAddress } from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountInitArgs,
  getNewAddressesParams,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";

interface UserCreationArgs {
  member: TransactionSigner;
  isPermanentMember: boolean;
}
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
  const proof = await getLightProtocolRpc().getValidityProofV0(
    [],
    newAddressParams
  );
  const userCreationArgs = await getCompressedAccountInitArgs(
    packedAccounts,
    proof.treeInfos,
    proof.roots,
    proof.rootIndices,
    newAddressParams
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
    })),
    remainingAccounts,
  });
}
