import {
  Address,
  type KeyPairSigner,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";

/**
 * Shared test context that is passed between test files
 */
export interface TestContext {
  connection: Rpc<SolanaRpcApi>;
  rpcSubscriptions: any;
  sendAndConfirm: any;
  payer: KeyPairSigner;
  wallet: KeyPairSigner;
  settings: Address | undefined;
  multiWalletVault: Address | undefined;
  rpId: string;
  origin: string;
}
