import { Address, Rpc, SolanaRpcApi, TransactionSigner } from "@solana/kit";
import { fetchMaybeTransactionBuffer } from "../generated";
import { Secp256r1Key } from "../types";
import { getTransactionBufferAddress } from "../utils";

export async function fetchTransactionBufferData(
  rpc: Rpc<SolanaRpcApi>,
  settings: Address,
  creator: TransactionSigner | Secp256r1Key,
  bufferIndex: number
) {
  const transactionBuffer = await getTransactionBufferAddress(
    settings,
    creator,
    bufferIndex
  );
  const result = await fetchMaybeTransactionBuffer(rpc, transactionBuffer);
  if (result.exists) {
    return result.data;
  } else {
    return null;
  }
}
