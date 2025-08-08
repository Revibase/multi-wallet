## Installation

```bash
npm install @revibase/wallet-sdk
```


## Quick Start

This SDK requires a Helius RPC endpoint to connect to the Solana network.
You can get one from Helius or any other Solana RPC provider that supports Helius features.


## Initialize the SDK

```bash
import { initializeMultiWallet } from "@revibase/wallet-sdk";

initializeMultiWallet({
  rpcEndpoint: INSERT_YOUR_HELIUS_ENDPOINT_HERE
});
```


## Use with Solana Wallet Adapter

Once initialized, it is now compatible with the Solana Wallet Adapter.
Simply integrate it into your existing Solana wallet flow.


## Example

```bash

import { useEffect } from "react";
import { initializeMultiWallet } from "@revibase/wallet-sdk";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";


export default function App() {
  // Initialize the Revibase Multi-Wallet SDK
  useEffect(() => {
    initializeMultiWallet({
      rpcEndpoint: RPC_ENDPOINT
    });
  }, []);


  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <div style={{ padding: "2rem" }}>
            <WalletMultiButton />
            {...}
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}


```
