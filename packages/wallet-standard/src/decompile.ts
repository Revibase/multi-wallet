import {
  decompileTransactionMessageFetchingLookupTables,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";

/**
 * Wallet Standard hands the wallet a fully serialized transaction. Revibase,
 * however, rebuilds its own vault-paid transaction from raw instructions
 * (see `executeTransaction` in @revibase/lite). So we decode the wire
 * transaction back into instructions, resolving any address lookup tables via
 * the RPC. The original fee payer and blockhash are intentionally dropped —
 * Revibase sets the vault as payer and supplies its own fee payer/blockhash.
 */
export async function decompileTransactionToInstructions(
  serializedTransaction: Uint8Array,
  rpc: Rpc<SolanaRpcApi>,
): Promise<Instruction[]> {
  const transaction = getTransactionDecoder().decode(serializedTransaction);
  const compiledMessage = getCompiledTransactionMessageDecoder().decode(
    transaction.messageBytes,
  );
  const decompiled = await decompileTransactionMessageFetchingLookupTables(
    compiledMessage,
    rpc,
  );
  return [...decompiled.instructions];
}
