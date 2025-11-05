import type { Address, TransactionSigner } from "gill";
import { SignedSecp256r1Key, type UserAccountWithAddressArgs } from ".";
import type { DelegateOpArgs } from "../generated";

export type PermissionArgs = {
  initiate: boolean;
  vote: boolean;
  execute: boolean;
};

type AddMemberArgs =
  | {
      setAsDelegate: true;
      account: {
        member: TransactionSigner | SignedSecp256r1Key;
        userAddressTreeIndex: number;
      };
      permissions: PermissionArgs;
      isTransactionManager: false;
    }
  | {
      setAsDelegate: false;
      account: {
        member: Address;
        userAddressTreeIndex: number;
      };
      permissions: { initiate: true; vote: false; execute: false };
      isTransactionManager: true;
    }
  | {
      setAsDelegate: false;
      account: {
        member: Address | SignedSecp256r1Key;
        userAddressTreeIndex: number;
      };
      permissions: PermissionArgs;
      isTransactionManager: false;
    };

export type ConfigurationArgs =
  | {
      type: "EditPermissions";
      members: {
        account: UserAccountWithAddressArgs;
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
      members: UserAccountWithAddressArgs[];
    }
  | { type: "SetThreshold"; threshold: number };
