import {
  AccountRole,
  address,
  Address,
  getBase58Decoder,
  IAccountMeta,
  IAccountSignerMeta,
  TransactionSigner,
} from "@solana/kit";
import {
  getCreateInstructionAsync,
  IPermissions,
  MemberWithVerifyArgs,
} from "../generated";
import { Permission, Permissions, Secp256r1Key } from "../types";
import { getDelegateAddress } from "../utils";
import { convertMember } from "../utils/private";

export async function createWallet({
  feePayer,
  initialMembers,
  metadata,
  createKey,
}: {
  feePayer: TransactionSigner;
  initialMembers: {
    pubkey: Address | Secp256r1Key;
    permissions: IPermissions;
    metadata: Address | null;
  }[];
  metadata: Address | null;
  createKey?: Address;
}) {
  if (!createKey) {
    createKey = address(
      getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(32)))
    );
  }
  const addMembers: MemberWithVerifyArgs[] = [];
  const remainingAccounts: (IAccountMeta | IAccountSignerMeta)[] = [];
  for (const x of initialMembers) {
    addMembers.push(convertMember(x));
    if (x.pubkey instanceof Secp256r1Key) {
      if (x.metadata) {
        remainingAccounts.push({
          address: x.metadata,
          role: AccountRole.READONLY,
        });
      } else {
        throw new Error(
          "Metadata cannot be null for Secp256r1Key. It needs to be linked to a domain config address."
        );
      }
    }
    if (Permissions.has(x.permissions, Permission.IsDelegate)) {
      remainingAccounts.push({
        address: await getDelegateAddress(x.pubkey),
        role: AccountRole.WRITABLE,
      });
    }
  }

  return getCreateInstructionAsync({
    payer: feePayer,
    initialMembers: addMembers,
    createKey,
    metadata,
    remainingAccounts,
  });
}
