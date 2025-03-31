import { PublicKey } from "@solana/web3.js";
import { MemberKey } from "./member";

export interface TransactionBuffer {
  multiWalletSettings: PublicKey;
  creator: MemberKey;
  voters: MemberKey[];
  expiry: number;
  rentPayer: PublicKey;
  bump: number;
  bufferIndex: number;
  finalBufferHash: Buffer;
  finalBufferSize: number;
  buffer: Buffer;
}
