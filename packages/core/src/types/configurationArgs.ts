import type { Address } from "gill";
import { Secp256r1Key } from ".";

export type PermissionArgs = {
  initiate: boolean;
  vote: boolean;
  execute: boolean;
};

type AddMemberArgs = {
  member: Address | Secp256r1Key;
  userAddressTreeIndex?: number;
  permissions: PermissionArgs;
};

type EditMemberArgs = {
  member: Address | Secp256r1Key;
  userAddressTreeIndex?: number;
  permissions: PermissionArgs;
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
