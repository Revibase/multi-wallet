import {
  type Address,
  type AddressesByLookupTableAddress,
  type KeyPairSigner,
} from "gill";

/**
 * Shared test context that is passed between test files
 */
export interface TestContext {
  payer: KeyPairSigner | undefined;
  wallet: KeyPairSigner | undefined;
  index: number | bigint | undefined;
  multiWalletVault: Address | undefined;
  rpId: string | undefined;
  origin: string | undefined;
  compressed: boolean;
  addressLookUpTable: AddressesByLookupTableAddress;
  domainConfig: Address | undefined;
}
