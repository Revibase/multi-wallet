import { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { fetchMaybeSettings } from "../generated";

export async function fetchSettingsData(
  rpc: Rpc<SolanaRpcApi>,
  settingsAddress: Address
) {
  const result = await fetchMaybeSettings(rpc, settingsAddress);
  if (result.exists) {
    return result.data;
  } else {
    return null;
  }
}
