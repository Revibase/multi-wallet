import { Address } from "@solana/kit";
import { Secp256r1Key } from ".";
import { IPermissions, UserMutArgs } from "../generated";

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
        userDelegateCloseArgs?: UserMutArgs;
        userDelegateCreationArgs?: UserMutArgs;
      }[];
    }
  | {
      type: "AddMembers";
      members: {
        pubkey: Address | Secp256r1Key;
        permissions: IPermissions;
        index: number;
        userDelegateCreationArgs?: UserMutArgs;
      }[];
    }
  | {
      type: "RemoveMembers";
      members: {
        pubkey: Address | Secp256r1Key;
        userDelegateCloseArgs?: UserMutArgs;
      }[];
    }
  | { type: "SetThreshold"; threshold: number };
