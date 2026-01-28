export const TRANSACTION_SIZE_LIMIT = 1644;
export const MIN_COMPUTE_UNITS = 200000;
export const COMPUTE_UNIT_MULTIPLIER = 1.1;

export const BUNDLE_POLL_MAX_RETRIES = 30;
export const BUNDLE_POLL_DELAY_MS = 3000;

export const DEFAULT_NETWORK_RETRY_MAX_RETRIES = 3;
export const DEFAULT_NETWORK_RETRY_DELAY_MS = 500;

export const EXPONENTIAL_BACKOFF_BASE = 2;
export const BACKOFF_MAX_DELAY_MS = 30000;

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

export const DEFAULT_JITO_BLOCK_ENGINE_URL =
  "https://mainnet.block-engine.jito.wtf/api/v1";
export const DEFAULT_JITO_TIPS_URL =
  "https://bundles.jito.wtf/api/v1/bundles/tip_floor";
export const DEFAULT_JITO_TIP_PRIORITY = "landed_tips_75th_percentile";

export const MAX_TRANSACTION_BUFFER_INDEX = 255;

export const HTTP_STATUS_BAD_REQUEST = 400;
export const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
export const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500;
