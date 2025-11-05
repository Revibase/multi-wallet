import type { Address } from "gill";
import type { Secp256r1Key } from "./secp256r1";

export type UserAccountWithAddressArgs = {
  member: Address | Secp256r1Key;
  userAddressTreeIndex: number;
};
