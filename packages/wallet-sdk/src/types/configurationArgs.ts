import { Address, TransactionSigner } from "@solana/kit";
import { Secp256r1Key } from ".";
import { DelegateOpArgs, IPermissions } from "../generated";

export type ConfigurationArgs =
  | {
      type: "EditPermissions";
      members: {
        pubkey: Address | Secp256r1Key;
        permissions: IPermissions;
        delegateOperation: DelegateOpArgs;
      }[];
    }
  | {
      type: "AddMembers";
      members: {
        pubkey: TransactionSigner | Secp256r1Key;
        permissions: IPermissions;
        setAsDelegate: boolean;
      }[];
    }
  | {
      type: "RemoveMembers";
      members: {
        pubkey: Address | Secp256r1Key;
      }[];
    }
  | { type: "SetThreshold"; threshold: number };
