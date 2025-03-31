import { Connection, PublicKey } from "@solana/web3.js";
import { Delegate, Secp256r1Key } from "../types";
import { getDelegateAddress, program } from "../utils";

export async function fetchDelegateData(
  connection: Connection,
  address: PublicKey | Secp256r1Key
) {
  const accountInfo = await connection.getAccountInfo(
    getDelegateAddress(address)
  );
  if (!accountInfo) {
    return null;
  }
  return program.coder.accounts.decode<Delegate>("delegate", accountInfo.data);
}
