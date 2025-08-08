## Installation

```bash
npm install @revibase/wallet-sdk
```


## Quick Start

This SDK requires a Helius RPC endpoint to connect to the Solana network.
You can get one from Helius or any other Solana RPC provider that supports Helius features. (DAS API & Photon RPC)


## Initialize the SDK

```bash
import { initializeMultiWallet } from "@revibase/wallet-sdk";

initializeMultiWallet({
  rpcEndpoint: INSERT_YOUR_HELIUS_RPC_ENDPOINT_HERE
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

  useEffect(() => {
    initializeMultiWallet({
      rpcEndpoint: INSERT_YOUR_HELIUS_RPC_ENDPOINT_HERE
    });
  }, []);


  return (
    <ConnectionProvider endpoint={INSERT_YOUR_HELIUS_RPC_ENDPOINT_HERE}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <div>
            <WalletMultiButton />
            {...}
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}


```
