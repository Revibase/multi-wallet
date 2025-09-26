import type {
  StandardConnectFeature,
  StandardConnectMethod,
  StandardDisconnectFeature,
  StandardDisconnectMethod,
  StandardEventsFeature,
  StandardEventsListeners,
  StandardEventsNames,
  StandardEventsOnMethod,
  Wallet,
} from "@wallet-standard/core";
import { address, getAddressEncoder } from "gill";
import type {
  RevibaseSignAndSendTransactionFeature,
  RevibaseSignAndSendTransactionMethod,
  RevibaseSignMessageFeature,
  RevibaseSignMessageMethod,
  RevibaseVerifySignedMessageFeature,
  RevibaseVerifySignedMessageMethod,
} from "./features.js";
import { icon } from "./icon.js";
import { bytesEqual } from "./util.js";
import { type Revibase, RevibaseWalletAccount } from "./window.js";

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
    return ["solana:mainnet"];
  }

  get features(): StandardConnectFeature &
    StandardDisconnectFeature &
    StandardEventsFeature &
    RevibaseSignMessageFeature &
    RevibaseVerifySignedMessageFeature &
    RevibaseSignAndSendTransactionFeature &
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
      "revibase:SignAndSendTransaction": {
        version: "1.0.0",
        signAndSendTransaction: this.#signAndSendTransaction,
      },
      "revibase:SignMessage": {
        version: "1.0.0",
        signMessage: this.#signMessage,
      },
      "revibase:VerifySignedMessage": {
        version: "1.0.0",
        verify: this.#verify,
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
    if (this.#account) {
      this.#connected();
    } else {
      this.#disconnected();
    }
  };

  #connect: StandardConnectMethod = async (input) => {
    if (!this.#account) {
      await this.#revibase.connect(input);
    }

    this.#connected();

    return { accounts: this.accounts };
  };

  #disconnect: StandardDisconnectMethod = async () => {
    await this.#revibase.disconnect();
  };

  #signAndSendTransaction: RevibaseSignAndSendTransactionMethod = (input) => {
    return this.#revibase.signAndSendTransaction(input);
  };

  #signMessage: RevibaseSignMessageMethod = (input) => {
    return this.#revibase.signMessage(input);
  };

  #verify: RevibaseVerifySignedMessageMethod = (input) => {
    return this.#revibase.verify(input);
  };
}
