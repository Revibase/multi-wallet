import { lamports } from "gill";

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

// Test amount constants (in lamports)
export const TEST_AMOUNT_SMALL = 10 ** 6;
export const TEST_AMOUNT_MEDIUM = 10 ** 8;
export const TEST_AMOUNT_LARGE = 10 ** 9;
export const TEST_MINT_DECIMALS = 5;

// Test configuration constants
export const TEST_TRANSACTION_MANAGER_URL = "https://xyz.com";
export const TEST_COMPUTE_UNIT_LIMIT = 800_000;
export const TEST_TRANSACTION_DELAY_MS = 500;
