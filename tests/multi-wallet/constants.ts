import { lamports } from "@solana/kit";

// Network constants
export const LOCAL_RPC_URL = "http://localhost:8899";
export const LOCAL_INDEXER_URL = "http://localhost:8784";
export const LOCAL_PROVER_URL = "http://localhost:3001";
export const LOCAL_WS_URL = "ws://localhost:8900";

// Amount constants
export const AIRDROP_AMOUNT = lamports(BigInt(10 ** 9));
export const WALLET_TRANSFER_AMOUNT = lamports(BigInt(10 ** 9 * 0.01));
export const LARGE_TRANSFER_AMOUNT = lamports(BigInt(10 ** 9 * 0.5));
export const SMALL_TRANSFER_AMOUNT = lamports(BigInt(10 ** 9 * 0.00002));
export const MEDIUM_TRANSFER_AMOUNT = lamports(BigInt(10 ** 9 * 0.3));
