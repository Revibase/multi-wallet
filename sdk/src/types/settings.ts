import { PublicKey } from "@solana/web3.js";
import { MemberKey } from "./member";
import { IPermissions } from "./permissions";

export interface Settings {
  createKey: PublicKey;
  threshold: number;
  multiWalletBump: number;
  bump: number;
  metadata: PublicKey | null;
  members: { pubkey: MemberKey; permissions: IPermissions }[];
}
