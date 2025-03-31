import { sha256 } from "@noble/hashes/sha256";
import { Connection } from "@solana/web3.js";
import { DomainConfig } from "src/types/domainConfig";
import { getDomainConfig, program } from "../utils";

export async function fetchDomainConfigData(
  connection: Connection,
  rpId: string
) {
  const accountInfo = await connection.getAccountInfo(
    getDomainConfig(sha256(new TextEncoder().encode(rpId)))
  );
  if (!accountInfo) {
    return null;
  }
  return program.coder.accounts.decode<DomainConfig>(
    "domainConfig",
    accountInfo.data
  );
}
