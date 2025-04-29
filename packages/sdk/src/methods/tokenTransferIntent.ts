import {
  TOKEN_PROGRAM_ADDRESS,
  fetchToken,
  findAssociatedTokenPda,
} from "@solana-program/token";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  fetchToken as fetchToken2022,
} from "@solana-program/token-2022";
import { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { fetchDelegateData } from "../functions";
import { getTokenTransferIntentInstructionAsync } from "../generated";
import { Secp256r1Key } from "../types";

export async function tokenTransferIntent({
  rpc,
  signer,
  mint,
  destination,
  tokenProgram,
  amount,
}: {
  rpc: Rpc<SolanaRpcApi>;
  signer: Secp256r1Key;
  mint: Address;
  destination: Address;
  tokenProgram: Address;
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

  const [sourceTokenAccount] = await findAssociatedTokenPda({
    owner: delegateData.multiWallet,
    tokenProgram,
    mint,
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
    owner: destination,
    tokenProgram,
    mint,
  });

  return await getTokenTransferIntentInstructionAsync({
    settings: delegateData.multiWalletSettings,
    domainConfig: signer.domainConfig,
    sourceTokenAccount,
    destination,
    destinationTokenAccount,
    mint,
    amount,
    secp256r1VerifyArgs: signer.verifyArgs,
  });
}
