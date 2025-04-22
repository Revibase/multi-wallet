import { Rpc, SolanaRpcApi } from "@solana/kit";
import { fetchMaybeDomainConfig } from "../generated";
import { getDomainConfig } from "../utils";

export async function fetchDomainConfigData(
  rpc: Rpc<SolanaRpcApi>,
  rpId: string
) {
  const result = await fetchMaybeDomainConfig(
    rpc,
    await getDomainConfig({ rpId })
  );
  if (result.exists) {
    return result.data;
  } else {
    return null;
  }
}
