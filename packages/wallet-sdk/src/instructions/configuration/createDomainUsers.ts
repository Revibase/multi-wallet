import { Address, none, some, TransactionSigner } from "@solana/kit";
import { getUserAddress } from "../../compressed";
import {
  convertToCompressedProofArgs,
  getCompressedAccountInitArgs,
  getNewAddressesParams,
} from "../../compressed/internal";
import { PackedAccounts } from "../../compressed/packedAccounts";
import {
  getCreateDomainUsersInstruction,
  getSecp256r1PubkeyDecoder,
  Transport,
} from "../../generated";
import { Secp256r1Key } from "../../types";
import { getLightProtocolRpc } from "../../utils";

interface UserCreationArgs {
  member: Secp256r1Key;
  credentialId: Uint8Array;
  mint?: Address;
  username?: string;
  expiry?: bigint;
  isPermanentMember: boolean;
  transports: Transport[];
}

export async function createDomainUsers({
  authority,
  payer,
  createUserArgs,
  domainConfig,
}: {
  domainConfig: Address;
  authority: TransactionSigner;
  payer: TransactionSigner;
  createUserArgs: UserCreationArgs[];
}) {
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();

  const newAddressParams = getNewAddressesParams(
    await Promise.all(
      createUserArgs.map(async (args) => ({
        pubkey: await getUserAddress(args.member),
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

  return getCreateDomainUsersInstruction({
    payer,
    authority,
    compressedProofArgs,
    createUserArgs: createUserArgs.map((x, index) => ({
      mint: x.mint ? some(x.mint) : none(),
      username: x.username ? some(x.username) : none(),
      expiry: x.expiry ? some(x.expiry) : none(),
      member: getSecp256r1PubkeyDecoder().decode(x.member.toBuffer()),
      userCreationArgs: userCreationArgs[index],
      credentialId: x.credentialId,
      isPermanentMember: x.isPermanentMember,
      transports: x.transports,
    })),
    domainConfig,
    remainingAccounts,
  });
}
