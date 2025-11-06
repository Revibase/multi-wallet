import {
  type Address,
  type AddressesByLookupTableAddress,
  type KeyPairSigner,
} from "gill";

/**
 * Shared test context that is passed between test files
 */
export interface TestContext {
  payer: KeyPairSigner;
  wallet: KeyPairSigner;
  index: number | bigint | undefined;
  multiWalletVault: Address | undefined;
  rpId: string;
  origin: string;
  compressed: boolean;
  addressLookUpTable: AddressesByLookupTableAddress;
  domainConfig: Address;
}
