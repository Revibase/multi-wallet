import {
  Address,
  decodeAccount,
  Decoder,
  fetchEncodedAccount,
  fixDecoderSize,
  GetAccountInfoApi,
  getAddressDecoder,
  getBytesDecoder,
  getStructDecoder,
  getU8Decoder,
  Rpc,
} from "@solana/kit";
import { getDelegateAddress, getMultiWalletFromSettings } from "..";
import { Secp256r1Key } from "../../types";

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

export async function fetchMaybeDelegate(
  rpc: Rpc<GetAccountInfoApi>,
  delegateAddress: Address | Secp256r1Key
) {
  const result = decodeAccount(
    await fetchEncodedAccount(rpc, await getDelegateAddress(delegateAddress)),
    getDelegateDecoder()
  );
  if (result.exists) {
    const delegate = result.data;

    return {
      ...delegate,
      multiWallet: await getMultiWalletFromSettings(
        delegate.multiWalletSettings
      ),
      multiWalletSettings: delegate.multiWalletSettings,
    };
  } else {
    return null;
  }
}
