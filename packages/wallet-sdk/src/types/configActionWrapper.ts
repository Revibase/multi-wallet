import { Secp256r1Key } from ".";
import { IPermissions } from "../generated";

export type ConfigActionWrapper =
  | {
      type: "EditPermissions";
      members: {
        pubkey: string | Secp256r1Key;
        permissions: IPermissions;
      }[];
    }
  | {
      type: "AddMembers";
      members: {
        pubkey: string | Secp256r1Key;
        permissions: IPermissions;
      }[];
    }
  | { type: "RemoveMembers"; members: (string | Secp256r1Key)[] }
  | { type: "SetThreshold"; threshold: number };
