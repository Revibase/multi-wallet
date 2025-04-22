import { Address } from "@solana/kit";
import { Secp256r1Key } from ".";
import { IPermissions } from "../generated";

export type ConfigActionWrapper =
  | {
      type: "SetMembers";
      members: {
        pubkey: Address | Secp256r1Key;
        permissions: IPermissions;
        metadata: Address | null;
      }[];
    }
  | {
      type: "AddMembers";
      members: {
        pubkey: Address | Secp256r1Key;
        permissions: IPermissions;
        metadata: Address | null;
      }[];
    }
  | { type: "RemoveMembers"; members: (Address | Secp256r1Key)[] }
  | { type: "SetThreshold"; threshold: number }
  | { type: "SetMetadata"; metadata: Address | null };
