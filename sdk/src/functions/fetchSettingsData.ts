import { Connection, PublicKey } from "@solana/web3.js";
import { Settings } from "../types";
import { program } from "../utils";

export async function fetchSettingsData(
  connection: Connection,
  settingsAddress: PublicKey
) {
  const accountInfo = await connection.getAccountInfo(settingsAddress);
  if (!accountInfo) {
    return null;
  }
  return program.coder.accounts.decode<Settings>("settings", accountInfo?.data);
}
