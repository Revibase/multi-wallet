import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { MultiWalletIdl } from "../idl/multi_wallet.js";
import { MultiWallet } from "../types";

// we are not using anchor to send any transactions so we can just use an empty provider
export const program = new Program<MultiWallet>(
  MultiWalletIdl as MultiWallet,
  new AnchorProvider(new Connection("https://api.mainnet-beta.solana.com"), {
    publicKey: PublicKey.default,
    signTransaction: async (tx) => Promise.resolve(tx),
    signAllTransactions: async (txs) => Promise.resolve(txs),
  })
);

export const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwbj2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

export const ADDRESS_LOOK_UP_TABLE = new PublicKey(
  "Hg5CGGARH2PSh7ceV8KVqZ6VqW5bnFqdFabziVddHsDZ"
);
