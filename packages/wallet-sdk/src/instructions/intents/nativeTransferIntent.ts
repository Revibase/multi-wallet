import { address, GetAccountInfoApi, Rpc } from "@solana/kit";
import { getNativeTransferIntentInstructionAsync } from "../../generated";
import { Secp256r1Key } from "../../types";
import { fetchMaybeDelegate } from "../../utils";

export async function nativeTransferIntent({
  rpc,
  signer,
  destination,
  amount,
}: {
  rpc: Rpc<GetAccountInfoApi>;
  signer: Secp256r1Key;
  destination: string;
  amount: number;
}) {
  const delegateData = await fetchMaybeDelegate(rpc, signer);
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
    domainConfig: address(signer.domainConfig),
    destination: address(destination),
    amount,
    secp256r1VerifyArgs: signer.verifyArgs,
  });
}
