import { Address } from "@solana/kit";
import { Secp256r1Key } from ".";
import {
  DelegateCreateOrMutateArgs,
  DelegateMutArgs,
  IPermissions,
} from "../generated";

export type ConfigActionWrapper =
  | {
      type: "EditPermissions";
      members: {
        pubkey: Address | Secp256r1Key;
        permissions: IPermissions;
      }[];
    }
  | {
      type: "AddMembers";
      members: {
        pubkey: Address | Secp256r1Key;
        permissions: IPermissions;
      }[];
    }
  | {
      type: "RemoveMembers";
      members: { pubkey: Address | Secp256r1Key }[];
    }
  | { type: "SetThreshold"; threshold: number };

export type ConfigActionWrapperWithDelegateArgs =
  | {
      type: "EditPermissions";
      members: {
        pubkey: Address | Secp256r1Key;
        permissions: IPermissions;
        delegateCloseArgs?: DelegateMutArgs;
        delegateCreateArgs?: DelegateCreateOrMutateArgs;
      }[];
    }
  | {
      type: "AddMembers";
      members: {
        pubkey: Address | Secp256r1Key;
        permissions: IPermissions;
        index: number;
        delegateArgs?: DelegateCreateOrMutateArgs;
      }[];
    }
  | {
      type: "RemoveMembers";
      members: {
        pubkey: Address | Secp256r1Key;
        delegateArgs?: DelegateMutArgs;
      }[];
    }
  | { type: "SetThreshold"; threshold: number };
