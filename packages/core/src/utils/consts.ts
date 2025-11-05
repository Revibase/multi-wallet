import { featureFlags, VERSION } from "@lightprotocol/stateless.js";

featureFlags.version = VERSION.V2;

export const REVIBASE_RP_ID = "revibase.com";
/**
 * Can be overriden during initialization
 */
export const REVIBASE_AUTH_ENDPOINT = "https://auth.revibase.com";

/**
 * Can be overriden during initialization
 */
export const REVIBASE_API_ENDPOINT = "https://api.revibase.com";
