import {
  Address,
  decodeAccount,
  Decoder,
  fetchEncodedAccount,
  fixDecoderSize,
  getAddressDecoder,
  getBytesDecoder,
  getStructDecoder,
  getU8Decoder,
  Rpc,
  SolanaRpcApi,
} from "@solana/kit";
import { Secp256r1Key } from "../types";
import { getDelegateAddress, getMultiWalletFromSettings } from "../utils";

export interface Delegate {
  multiWalletSettings: Address;
  bump: number;
}

export function getDelegateDecoder(): Decoder<Delegate> {
  return getStructDecoder([
    ["discriminator", fixDecoderSize(getBytesDecoder(), 8)],
    ["multiWalletSettings", getAddressDecoder()],
    ["bump", getU8Decoder()],
  ]);
}

export async function fetchDelegateData(
  rpc: Rpc<SolanaRpcApi>,
  address: Address | Secp256r1Key
) {
  const result = decodeAccount(
    await fetchEncodedAccount(rpc, await getDelegateAddress(address)),
    getDelegateDecoder()
  );
  if (result.exists) {
    const delegate = result.data;

    return {
      ...delegate,
      multiWallet: await getMultiWalletFromSettings(
        delegate.multiWalletSettings
      ),
    };
  } else {
    return null;
  }
}
