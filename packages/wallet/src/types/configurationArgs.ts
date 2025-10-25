import type { Address, TransactionSigner } from "gill";
import { Secp256r1Key, SignedSecp256r1Key } from ".";
import type { DelegateOpArgs } from "../generated";

export type PermissionArgs = {
  initiate: boolean;
  vote: boolean;
  execute: boolean;
};

type AddMemberArgs =
  | {
      setAsDelegate: true;
      pubkey: TransactionSigner | SignedSecp256r1Key;
      permissions: PermissionArgs;
      isTransactionManager: false;
    }
  | {
      setAsDelegate: false;
      pubkey: Address;
      permissions: { initiate: true; vote: false; execute: false };
      isTransactionManager: true;
    }
  | {
      setAsDelegate: false;
      pubkey: Address | SignedSecp256r1Key;
      permissions: PermissionArgs;
      isTransactionManager: false;
    };

export type ConfigurationArgs =
  | {
      type: "EditPermissions";
      members: {
        pubkey: Address | Secp256r1Key;
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
        pubkey: Address | Secp256r1Key;
      }[];
    }
  | { type: "SetThreshold"; threshold: number };
