import { TransactionSigner } from "@solana/kit";
import { registerWallet } from "@wallet-standard/core";
import { createRevibaseAdapter } from "./core";
import { getRandomPayer } from "./util";
import { RevibaseWallet } from "./wallet";

export async function initializeAdapter({
  rpcEndpoint,
  feePayer,
  estimateJitoTipEndpoint = `https://proxy.revibase.com/?url=https://bundles.jito.wtf/api/v1/bundles/tip_floor`,
  jitoBlockEngineEndpoint = `https://mainnet.block-engine.jito.wtf/api/v1`,
}: {
  rpcEndpoint: string;
  feePayer?: TransactionSigner;
  estimateJitoTipEndpoint?: string;
  jitoBlockEngineEndpoint?: string;
}) {
  feePayer = feePayer ?? (await getRandomPayer("https://api.revibase.com"));

  registerWallet(
    new RevibaseWallet(
      createRevibaseAdapter({
        feePayer,
        jitoBlockEngineEndpoint,
        estimateJitoTipEndpoint,
        rpcEndpoint,
      })
    )
  );
}
