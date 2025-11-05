import type { SettingsIndexWithAddress } from "@revibase/core";
import {
  type Address,
  type AddressesByLookupTableAddress,
  type KeyPairSigner,
} from "gill";

/**
 * Shared test context that is passed between test files
 */
export interface TestContext {
  payer: { member: KeyPairSigner; userAddressTreeIndex: number };
  wallet: { member: KeyPairSigner; userAddressTreeIndex: number };
  settingsIndexWithAddress: SettingsIndexWithAddress | undefined;
  multiWalletVault: Address | undefined;
  rpId: string;
  origin: string;
  compressed: boolean;
  addressLookUpTable: AddressesByLookupTableAddress;
  domainConfig: Address;
}
