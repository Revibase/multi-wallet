import { PublicKey } from "@solana/web3.js";
import { Member } from "./member.js";
import { Secp256r1Key } from "./secp256r1.js";

export type ConfigAction =
  | { type: "setMembers"; members: Member[] }
  | { type: "addMembers"; members: Member[] }
  | { type: "removeMembers"; members: (PublicKey | Secp256r1Key)[] }
  | { type: "setThreshold"; threshold: number }
  | { type: "setMetadata"; metadata: PublicKey | null };
