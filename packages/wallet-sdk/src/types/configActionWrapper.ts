import { Address } from "@solana/kit";
import { Secp256r1Key } from ".";
import { IPermissions } from "../generated";

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
  | { type: "RemoveMembers"; members: (Address | Secp256r1Key)[] }
  | { type: "SetThreshold"; threshold: number };
