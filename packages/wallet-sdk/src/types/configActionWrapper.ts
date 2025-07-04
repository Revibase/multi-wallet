import { Address } from "@solana/kit";
import { Secp256r1Key } from ".";
import {
  DelegateCloseArgs,
  DelegateCreationArgs,
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
      members: { pubkey: Address | Secp256r1Key; permissions: IPermissions }[];
    }
  | { type: "SetThreshold"; threshold: number };

export type ConfigActionWrapperWithDelegateArgs =
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
        delegateArgs?: DelegateCreationArgs;
      }[];
    }
  | {
      type: "RemoveMembers";
      members: {
        pubkey: Address | Secp256r1Key;
        delegateArgs?: DelegateCloseArgs;
      }[];
    }
  | { type: "SetThreshold"; threshold: number };
