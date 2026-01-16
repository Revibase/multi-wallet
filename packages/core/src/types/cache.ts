import type {
  CompressedAccount,
  ParsedTokenAccount,
  WithCursor,
} from "@lightprotocol/stateless.js";
import type { AccountInfoBase, Base64EncodedDataResponse, Slot } from "gill";

/**
 * Cached account data types
 */
export type CachedAccountData =
  | (CompressedAccount | null)
  | WithCursor<ParsedTokenAccount[]>
  | Readonly<{
      context: Readonly<{
        slot: Slot;
      }>;
      value:
        | (AccountInfoBase &
            Readonly<{
              data: Base64EncodedDataResponse;
            }>)
        | null;
    }>;

/**
 * Cache for account data to avoid redundant RPC calls
 * Key: Account address as string
 * Value: Cached account data
 */
export type AccountCache = Map<string, CachedAccountData>;
