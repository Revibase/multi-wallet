import type { RevibaseProvider } from "@revibase/lite";
import { registerWallet } from "@wallet-standard/wallet";
import { RevibaseWallet, type RevibaseWalletOptions } from "./wallet";

/**
 * Registers Revibase as a Wallet Standard wallet so any Solana dApp
 * (`@solana/wallet-adapter`, wallet-standard modals, framework-kit
 * ConnectorKit, …) discovers it via `getWallets()`.
 *
 * Call once at app startup. `registerWallet` dispatches the registration
 * event, so it does not matter whether the dApp's adapter mounts before or
 * after this call.
 *
 * @param provider A configured {@link RevibaseProvider} (needs `rpcEndpoint`
 *   and a backend `/api/clientAuthorization` callback).
 * @returns The {@link RevibaseWallet} instance that was registered.
 */
export function registerRevibaseWallet(
  provider: RevibaseProvider,
  options?: RevibaseWalletOptions,
): RevibaseWallet {
  const wallet = new RevibaseWallet(provider, options);
  registerWallet(wallet);
  return wallet;
}
