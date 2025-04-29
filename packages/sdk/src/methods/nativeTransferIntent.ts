import { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { fetchDelegateData } from "../functions";
import { getNativeTransferIntentInstructionAsync } from "../generated";
import { Secp256r1Key } from "../types";

export async function nativeTransferIntent({
  rpc,
  signer,
  destination,
  amount,
}: {
  rpc: Rpc<SolanaRpcApi>;
  signer: Secp256r1Key;
  destination: Address;
  amount: number;
}) {
  const delegateData = await fetchDelegateData(rpc, signer);
  if (!delegateData) {
    throw new Error(
      "Missing delegate account: Signer is not authorized for delegated transfers."
    );
  }
  if (!signer.domainConfig || !signer.verifyArgs) {
    throw new Error(
      "Incomplete signer configuration: domainConfig or verifyArgs is missing."
    );
  }

  const accountInfo = await rpc.getAccountInfo(delegateData.multiWallet).send();
  if ((accountInfo.value?.lamports ?? 0) < amount) {
    throw new Error(`Insufficient balance.`);
  }

  return await getNativeTransferIntentInstructionAsync({
    settings: delegateData.multiWalletSettings,
    domainConfig: signer.domainConfig,
    destination,
    amount,
    secp256r1VerifyArgs: signer.verifyArgs,
  });
}
