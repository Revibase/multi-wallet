import { Connection, PublicKey } from "@solana/web3.js";
import { TransactionBuffer } from "src/types/transactionBuffer";
import { Secp256r1Key } from "../types";
import { getTransactionBufferAddress, program } from "../utils";

export async function fetchTransactionBufferData(
  connection: Connection,
  settings: PublicKey,
  creator: PublicKey | Secp256r1Key,
  bufferIndex: number
) {
  const transactionBuffer = getTransactionBufferAddress(
    settings,
    creator,
    bufferIndex
  );
  const accountInfo = await connection.getAccountInfo(transactionBuffer);
  if (!accountInfo) {
    return null;
  }
  return program.coder.accounts.decode<TransactionBuffer>(
    "transactionBuffer",
    accountInfo.data
  );
}
