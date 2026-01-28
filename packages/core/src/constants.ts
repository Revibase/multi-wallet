/**
 * Constants used throughout the SDK
 */

/** Maximum transaction size in bytes (Solana limit) */
export const TRANSACTION_SIZE_LIMIT = 1644;

/** Minimum compute units required for transactions */
export const MIN_COMPUTE_UNITS = 200000;
/** Multiplier applied to estimated compute units for safety margin */
export const COMPUTE_UNIT_MULTIPLIER = 1.1;

/** Maximum number of retries when polling for bundle confirmation */
export const BUNDLE_POLL_MAX_RETRIES = 30;
/** Delay between bundle confirmation polls in milliseconds */
export const BUNDLE_POLL_DELAY_MS = 3000;

/** Default maximum retry attempts for network operations */
export const DEFAULT_NETWORK_RETRY_MAX_RETRIES = 3;
/** Default initial delay between retries in milliseconds */
export const DEFAULT_NETWORK_RETRY_DELAY_MS = 500;

/** Base multiplier for exponential backoff calculation */
export const EXPONENTIAL_BACKOFF_BASE = 2;
/** Maximum delay cap for exponential backoff in milliseconds */
export const BACKOFF_MAX_DELAY_MS = 30000;

/**
 * Jito tip accounts
 */
export const JITO_TIP_ACCOUNTS = [
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
] as const;

/**
 * Default Jito configuration
 */
export const DEFAULT_JITO_BLOCK_ENGINE_URL =
  "https://mainnet.block-engine.jito.wtf/api/v1";
export const DEFAULT_JITO_TIPS_URL =
  "https://bundles.jito.wtf/api/v1/bundles/tip_floor";
export const DEFAULT_JITO_TIP_PRIORITY = "landed_tips_75th_percentile";

/**
 * Transaction buffer index limits
 */
export const MAX_TRANSACTION_BUFFER_INDEX = 255;

/**
 * HTTP status codes
 */
export const HTTP_STATUS_BAD_REQUEST = 400;
export const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
export const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500;
