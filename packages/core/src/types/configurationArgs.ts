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
      delegateOperation: DelegateOp.Add;
      member: TransactionSigner | SignedSecp256r1Key;
      userAddressTreeIndex?: number;
      permissions: PermissionArgs;
      isTransactionManager: false;
    }
  | {
      delegateOperation: DelegateOp.Ignore;
      member: Address;
      userAddressTreeIndex?: number;
      permissions: { initiate: true; vote: false; execute: false };
      isTransactionManager: true;
    }
  | {
      delegateOperation: DelegateOp.Ignore;
      member: Address | SignedSecp256r1Key;
      userAddressTreeIndex?: number;
      permissions: PermissionArgs;
      isTransactionManager: false;
    };

export type ConfigurationArgs =
  | {
      type: "EditPermissions";
      members: {
        member: Address | Secp256r1Key;
        userAddressTreeIndex?: number;
        permissions: PermissionArgs;
        delegateOperation: DelegateOpArgs;
      }[];
    }
  | {
      type: "AddMembers";
      members: AddMemberArgs[];
    }
  | {
      type: "RemoveMembers";
      members: {
        member: Address | Secp256r1Key;
        userAddressTreeIndex?: number;
      }[];
    }
  | { type: "SetThreshold"; threshold: number };
