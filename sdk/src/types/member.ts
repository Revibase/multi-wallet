import { PublicKey } from "@solana/web3.js";
import { KeyType } from "./keyType.js";
import { IPermissions } from "./permissions.js";
import { Secp256r1Key } from "./secp256r1.js";

export type Member = {
  pubkey: PublicKey | Secp256r1Key;
  permissions: IPermissions;
};

export type MemberKey = {
  keyType: KeyType;
  key: Buffer;
};
