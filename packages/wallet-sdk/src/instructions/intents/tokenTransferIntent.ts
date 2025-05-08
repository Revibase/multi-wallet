import {
  TOKEN_PROGRAM_ADDRESS,
  fetchToken,
  findAssociatedTokenPda,
} from "@solana-program/token";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  fetchToken as fetchToken2022,
} from "@solana-program/token-2022";
import { GetAccountInfoApi, Rpc, address } from "@solana/kit";
import { getTokenTransferIntentInstructionAsync } from "../../generated";
import { Secp256r1Key } from "../../types";
import { fetchMaybeDelegate } from "../../utils";

export async function tokenTransferIntent({
  rpc,
  signer,
  mint,
  destination,
  tokenProgram,
  amount,
}: {
  rpc: Rpc<GetAccountInfoApi>;
  signer: Secp256r1Key;
  mint: string;
  destination: string;
  tokenProgram: string;
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

  const [sourceTokenAccount] = await findAssociatedTokenPda({
    owner: delegateData.multiWallet,
    tokenProgram: address(tokenProgram),
    mint: address(tokenProgram),
  });

  try {
    if (tokenProgram === TOKEN_PROGRAM_ADDRESS) {
      const token = await fetchToken(rpc, sourceTokenAccount);
      if (token.data.amount < amount) {
        throw new Error(`Insufficient balance.`);
      }
    } else if (tokenProgram === TOKEN_2022_PROGRAM_ADDRESS) {
      const token = await fetchToken2022(rpc, sourceTokenAccount);
      if (token.data.amount < amount) {
        throw new Error(`Insufficient balance.`);
      }
    } else {
      throw new Error(`Unsupported token program: ${tokenProgram.toString()}`);
    }
  } catch (error) {
    throw new Error(
      `Failed to fetch source token account: ${sourceTokenAccount.toString()}. ` +
        `It may not exist or is inaccessible.`
    );
  }

  const [destinationTokenAccount] = await findAssociatedTokenPda({
    owner: address(destination),
    tokenProgram,
    mint: address(mint),
  });

  return await getTokenTransferIntentInstructionAsync({
    settings: address(delegateData.multiWalletSettings),
    domainConfig: address(signer.domainConfig),
    sourceTokenAccount,
    destination: address(destination),
    destinationTokenAccount,
    mint: address(mint),
    amount,
    secp256r1VerifyArgs: signer.verifyArgs,
  });
}
