import type { Address, TransactionSigner } from "gill";
import { Secp256r1Key, SignedSecp256r1Key } from ".";
import type { DelegateOp, DelegateOpArgs } from "../generated";

export type PermissionArgs = {
  initiate: boolean;
  vote: boolean;
  execute: boolean;
};

type AddMemberArgs =
  | {
      member: TransactionSigner | SignedSecp256r1Key;
      userAddressTreeIndex?: number;
      permissions: PermissionArgs;
      delegateOperation: DelegateOp.Add;
    }
  | {
      member: Address | SignedSecp256r1Key;
      userAddressTreeIndex?: number;
      permissions: PermissionArgs;
      delegateOperation: DelegateOp.Ignore;
    };

type EditMemberArgs = {
  member: Address | Secp256r1Key;
  userAddressTreeIndex?: number;
  permissions: PermissionArgs;
  delegateOperation: DelegateOpArgs;
};

type RemoveMemberArgs = {
  member: Address | Secp256r1Key;
  userAddressTreeIndex?: number;
};

export type ConfigurationArgs =
  | {
      type: "EditPermissions";
      members: EditMemberArgs[];
    }
  | {
      type: "AddMembers";
      members: AddMemberArgs[];
    }
  | {
      type: "RemoveMembers";
      members: RemoveMemberArgs[];
    }
  | { type: "SetThreshold"; threshold: number };
