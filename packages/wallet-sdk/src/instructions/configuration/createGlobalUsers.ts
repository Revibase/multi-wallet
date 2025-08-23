import { Address, TransactionSigner } from "@solana/kit";
import { getUserAddress } from "../../compressed";
import {
  convertToCompressedProofArgs,
  getCompressedAccountInitArgs,
  getNewAddressesParams,
} from "../../compressed/internal";
import { PackedAccounts } from "../../compressed/packedAccounts";
import { getCreateGlobalUsersInstruction } from "../../generated";
import { getLightProtocolRpc } from "../../utils";

export async function createGlobalUsers({
  members,
  payer,
}: {
  payer: TransactionSigner;
  members: Address[];
}) {
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();

  const newAddressParams = getNewAddressesParams(
    await Promise.all(
      members.map(async (member) => ({
        pubkey: await getUserAddress(member),
        type: "User",
      }))
    )
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
    createUserArgs: members.map((x, index) => ({
      member: x,
      userCreationArgs: userCreationArgs[index],
    })),
    remainingAccounts,
  });
}
