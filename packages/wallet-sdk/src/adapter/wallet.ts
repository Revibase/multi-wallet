import { address, getAddressEncoder, getBase58Encoder } from "@solana/kit";
import {
  SolanaSignAndSendTransactionFeature,
  SolanaSignAndSendTransactionMethod,
  SolanaSignAndSendTransactionOutput,
  SolanaSignTransactionMethod,
  type SolanaSignInFeature,
  type SolanaSignInMethod,
  type SolanaSignMessageFeature,
  type SolanaSignMessageMethod,
  type SolanaSignMessageOutput,
  type SolanaSignTransactionFeature,
  type SolanaSignTransactionOutput,
} from "@solana/wallet-standard-features";
import type { Wallet } from "@wallet-standard/base";
import {
  type StandardConnectFeature,
  type StandardConnectMethod,
  type StandardDisconnectFeature,
  type StandardDisconnectMethod,
  type StandardEventsFeature,
  type StandardEventsListeners,
  type StandardEventsNames,
  type StandardEventsOnMethod,
} from "@wallet-standard/features";
import { icon } from "./icon.js";
import { bytesEqual } from "./util.js";
import {
  Revibase,
  RevibaseSolanaSignInOutput,
  RevibaseWalletAccount,
} from "./window.js";

export const RevibaseNamespace = "revibase:";

export type RevibaseFeature = {
  [RevibaseNamespace]: {
    revibase: Revibase;
  };
};

export class RevibaseWallet implements Wallet {
  readonly #listeners: {
    [E in StandardEventsNames]?: StandardEventsListeners[E][];
  } = {};
  readonly #version = "1.0.0" as const;
  readonly #name = "Revibase" as const;
  readonly #icon = icon;
  #account: RevibaseWalletAccount | null = null;
  readonly #revibase: Revibase;

  get version() {
    return this.#version;
  }

  get name() {
    return this.#name;
  }

  get icon() {
    return this.#icon;
  }

  get chains(): readonly `${string}:${string}`[] {
    return ["solana:mainnet", "solana:devnet", "solana:localnet"];
  }

  get features(): StandardConnectFeature &
    StandardDisconnectFeature &
    StandardEventsFeature &
    SolanaSignAndSendTransactionFeature &
    SolanaSignTransactionFeature &
    SolanaSignMessageFeature &
    SolanaSignInFeature &
    RevibaseFeature {
    return {
      "standard:connect": {
        version: "1.0.0",
        connect: this.#connect,
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: this.#disconnect,
      },
      "standard:events": {
        version: "1.0.0",
        on: this.#on,
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: [0],
        signTransaction: this.#signTransaction,
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: [0],
        signAndSendTransaction: this.#signAndSendTransaction,
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: this.#signMessage,
      },
      "solana:signIn": {
        version: "1.0.0",
        signIn: this.#signIn,
      },
      "revibase:": {
        revibase: this.#revibase,
      },
    };
  }

  get accounts() {
    return this.#account ? [this.#account] : [];
  }

  constructor(revibase: Revibase) {
    if (new.target === RevibaseWallet) {
      Object.freeze(this);
    }

    this.#revibase = revibase;

    revibase.on("connect", this.#connected, this);
    revibase.on("disconnect", this.#disconnected, this);
    revibase.on("accountChanged", this.#reconnected, this);

    this.#connected();
  }

  #signAndSendTransaction: SolanaSignAndSendTransactionMethod = async (
    ...inputs
  ) => {
    if (!this.#account) throw new Error("not connected");

    const outputs: SolanaSignAndSendTransactionOutput[] = [];

    for (const input of inputs) {
      const { transaction, account, chain, options } = input;
      if (account !== this.#account) throw new Error("invalid account");
      if (chain && this.chains.includes(chain) === false)
        throw new Error("invalid chain");

      const signature = await this.#revibase.signAndSendTransaction(
        transaction,
        options
      );

      outputs.push({
        signature: new Uint8Array(getBase58Encoder().encode(signature)),
      });
    }

    return outputs;
  };

  #on: StandardEventsOnMethod = (event, listener) => {
    this.#listeners[event]?.push(listener) ||
      (this.#listeners[event] = [listener]);
    return (): void => this.#off(event, listener);
  };

  #emit<E extends StandardEventsNames>(
    event: E,
    ...args: Parameters<StandardEventsListeners[E]>
  ): void {
    // eslint-disable-next-line prefer-spread
    this.#listeners[event]?.forEach((listener) => listener.apply(null, args));
  }

  #off<E extends StandardEventsNames>(
    event: E,
    listener: StandardEventsListeners[E]
  ): void {
    this.#listeners[event] = this.#listeners[event]?.filter(
      (existingListener) => listener !== existingListener
    );
  }

  #connected = () => {
    const pubKey = this.#revibase.publicKey;
    const member = this.#revibase.member;
    const index = this.#revibase.index;
    if (pubKey && member && index) {
      const publicKey = new Uint8Array(
        getAddressEncoder().encode(address(pubKey))
      );
      const account = this.#account;
      if (
        !account ||
        account.address !== pubKey.toString() ||
        !bytesEqual(account.publicKey, publicKey)
      ) {
        this.#account = new RevibaseWalletAccount(
          {
            address: pubKey,
            publicKey,
            chains: this.chains,
            features: Object.keys(
              this.features
            ) as readonly `${string}:${string}`[],
          },
          member,
          index
        );
        this.#emit("change", { accounts: this.accounts });
      }
    }
  };

  #disconnected = () => {
    if (this.#account) {
      this.#account = null;
      this.#emit("change", { accounts: this.accounts });
    }
  };

  #reconnected = () => {
    if (this.#revibase.publicKey) {
      this.#connected();
    } else {
      this.#disconnected();
    }
  };

  #connect: StandardConnectMethod = async ({ silent } = {}) => {
    if (!this.#account) {
      await this.#revibase.connect(
        silent ? { onlyIfTrusted: true } : undefined
      );
    }

    this.#connected();

    return { accounts: this.accounts };
  };

  #disconnect: StandardDisconnectMethod = async () => {
    this.#revibase.disconnect();
  };

  #signTransaction: SolanaSignTransactionMethod = async (...inputs) => {
    if (!this.#account) throw new Error("not connected");
    const outputs: SolanaSignTransactionOutput[] = [];
    for (const input of inputs) {
      if (
        input.account &&
        !bytesEqual(
          new Uint8Array(input.account.publicKey),
          this.#account.publicKey
        )
      ) {
        throw new Error("invalid account");
      }
      if (input.chain && this.chains.includes(input.chain) === false)
        throw new Error("invalid chain");

      const serializedTransactions = await this.#revibase.signTransaction(
        input.transaction
      );

      for (const serializedTransaction of serializedTransactions) {
        outputs.push({
          signedTransaction: serializedTransaction,
        });
      }
    }

    return outputs;
  };

  #signMessage: SolanaSignMessageMethod = async (...inputs) => {
    if (!this.#account) throw new Error("not connected");
    const outputs: SolanaSignMessageOutput[] = [];
    for (const input of inputs) {
      const { message, account } = input;
      if (
        account &&
        !bytesEqual(new Uint8Array(account.publicKey), this.#account.publicKey)
      ) {
        throw new Error("invalid account");
      }
      const { signature } = await this.#revibase.signMessage(message);
      outputs.push({ signedMessage: message, signature });
    }

    return outputs;
  };

  #signIn: SolanaSignInMethod = async (...inputs) => {
    const outputs: RevibaseSolanaSignInOutput[] = [];
    for (const input of inputs) {
      const result = await this.#revibase.signIn(input);
      outputs.push({
        ...result,
        account: new RevibaseWalletAccount(
          {
            address: result.publicKey,
            publicKey: getAddressEncoder().encode(address(result.publicKey)),
            chains: this.chains,
            features: Object.keys(
              this.features
            ) as readonly `${string}:${string}`[],
          },
          result.member,
          result.index
        ),
      });
    }

    return outputs;
  };
}
