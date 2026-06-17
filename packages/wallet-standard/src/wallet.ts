import { getSolanaRpc, type UserInfo } from "@revibase/core";
import {
  executeTransaction,
  signIn,
  type RevibaseProvider,
} from "@revibase/lite";
import { getBase58Encoder } from "@solana/kit";
import {
  SOLANA_DEVNET_CHAIN,
  SOLANA_MAINNET_CHAIN,
} from "@solana/wallet-standard-chains";
import {
  SolanaSignAndSendTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignAndSendTransactionMethod,
} from "@solana/wallet-standard-features";
import type {
  IdentifierArray,
  Wallet,
  WalletAccount,
  WalletIcon,
} from "@wallet-standard/base";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardConnectMethod,
  type StandardDisconnectFeature,
  type StandardDisconnectMethod,
  type StandardEventsChangeProperties,
  type StandardEventsFeature,
  type StandardEventsListeners,
  type StandardEventsOnMethod,
} from "@wallet-standard/features";
import { RevibaseWalletAccount } from "./account";
import { decompileTransactionToInstructions } from "./decompile";
import { REVIBASE_ICON } from "./icon";

export type RevibaseWalletOptions = {
  /** Display name shown in wallet pickers. Defaults to "Revibase". */
  name?: string;
  /** Inline icon (data URI). Defaults to the bundled Revibase mark. */
  icon?: WalletIcon;
  /** Chains to advertise. Defaults to Solana mainnet + devnet. */
  chains?: IdentifierArray;
};

const DEFAULT_NAME = "Revibase";
const DEFAULT_CHAINS: IdentifierArray = [
  SOLANA_MAINNET_CHAIN,
  SOLANA_DEVNET_CHAIN,
];

type RevibaseFeature = StandardConnectFeature &
  StandardDisconnectFeature &
  StandardEventsFeature &
  SolanaSignAndSendTransactionFeature;

/**
 * Wraps an existing {@link RevibaseProvider} as a Wallet Standard wallet so
 * Solana dApps discover and connect to Revibase via `registerWallet()` /
 * `getWallets()`.
 *
 * Supported features: `standard:connect`, `standard:disconnect`,
 * `standard:events`, and `solana:signAndSendTransaction`. Raw
 * `solana:signTransaction`, `solana:signMessage`, and `solana:signIn` are
 * intentionally NOT advertised — see the package README "Constraints".
 */
export class RevibaseWallet implements Wallet {
  readonly #provider: RevibaseProvider;
  readonly #name: string;
  readonly #icon: WalletIcon;
  readonly #chains: IdentifierArray;

  #account: RevibaseWalletAccount | null = null;
  #user: UserInfo | null = null;
  // The only Wallet Standard event is "change".
  readonly #changeListeners: StandardEventsListeners["change"][] = [];

  constructor(provider: RevibaseProvider, options?: RevibaseWalletOptions) {
    this.#provider = provider;
    this.#name = options?.name ?? DEFAULT_NAME;
    this.#icon = options?.icon ?? REVIBASE_ICON;
    this.#chains = options?.chains ?? DEFAULT_CHAINS;
  }

  get version() {
    return "1.0.0" as const;
  }

  get name() {
    return this.#name;
  }

  get icon() {
    return this.#icon;
  }

  get chains() {
    return this.#chains.slice();
  }

  get accounts(): readonly WalletAccount[] {
    return this.#account ? [this.#account] : [];
  }

  get features(): RevibaseFeature {
    return {
      [StandardConnect]: {
        version: "1.0.0",
        connect: this.#connect,
      },
      [StandardDisconnect]: {
        version: "1.0.0",
        disconnect: this.#disconnect,
      },
      [StandardEvents]: {
        version: "1.0.0",
        on: this.#on,
      },
      [SolanaSignAndSendTransaction]: {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signAndSendTransaction: this.#signAndSendTransaction,
      },
    };
  }

  #connect: StandardConnectMethod = async (input) => {
    if (!this.#account) {
      if (input?.silent) {
        // Revibase has no silent/auto-connect path (requires a passkey prompt).
        return { accounts: this.accounts };
      }
      const { user } = await signIn(this.#provider);
      if (!user.walletAddress) {
        throw new Error(
          "Revibase sign-in returned no walletAddress; cannot expose an account.",
        );
      }
      this.#user = user;
      this.#account = new RevibaseWalletAccount(user.walletAddress, this.#chains);
      this.#emitChange({ accounts: this.accounts });
    }
    return { accounts: this.accounts };
  };

  #disconnect: StandardDisconnectMethod = async () => {
    if (this.#account) {
      this.#account = null;
      this.#user = null;
      this.#emitChange({ accounts: this.accounts });
    }
  };

  #on: StandardEventsOnMethod = (event, listener) => {
    if (event !== "change") return () => {};
    this.#changeListeners.push(listener);
    return () => {
      const index = this.#changeListeners.indexOf(listener);
      if (index !== -1) this.#changeListeners.splice(index, 1);
    };
  };

  #emitChange(properties: StandardEventsChangeProperties): void {
    for (const listener of this.#changeListeners.slice()) {
      listener(properties);
    }
  }

  #signAndSendTransaction: SolanaSignAndSendTransactionMethod = async (
    ...inputs
  ) => {
    if (!this.#user) {
      throw new Error("Wallet not connected. Call connect() first.");
    }
    const rpc = getSolanaRpc();
    const outputs: { signature: Uint8Array }[] = [];
    // Process sequentially: each requires its own passkey approval popup.
    for (const { transaction } of inputs) {
      const instructions = await decompileTransactionToInstructions(
        transaction,
        rpc,
      );
      const { txSig } = await executeTransaction(this.#provider, {
        instructions,
        signer: this.#user,
      });
      if (!txSig) {
        throw new Error("Revibase did not return a transaction signature.");
      }
      outputs.push({
        signature: new Uint8Array(getBase58Encoder().encode(txSig)),
      });
    }
    return outputs;
  };
}

// Re-export for consumers that want the event property type.
export type { StandardEventsChangeProperties };
