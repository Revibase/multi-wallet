import {
  TOKEN_PROGRAM_ADDRESS,
  fetchToken,
  findAssociatedTokenPda,
} from "@solana-program/token";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  fetchToken as fetchToken2022,
} from "@solana-program/token-2022";
import {
  AccountRole,
  Address,
  GetAccountInfoApi,
  IAccountSignerMeta,
  IInstruction,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
import { getTokenTransferIntentInstructionAsync } from "../../generated";
import { Secp256r1Key } from "../../types";
import { fetchMaybeDelegate } from "../../utils";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../../utils/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export async function tokenTransferIntent({
  rpc,
  creator,
  additionalVoters,
  mint,
  destination,
  tokenProgram,
  amount,
}: {
  rpc: Rpc<GetAccountInfoApi>;
  creator: TransactionSigner | Secp256r1Key;
  additionalVoters?: (TransactionSigner | Secp256r1Key)[];
  mint: Address;
  destination: Address;
  tokenProgram: Address;
  amount: number;
}) {
  const delegateData = await fetchMaybeDelegate(
    rpc,
    creator instanceof Secp256r1Key ? creator : creator.address
  );
  if (!delegateData) {
    throw new Error(
      "Missing delegate account: Signer is not authorized for delegated transfers."
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
    throw new Error(`Insufficient balance.`);
  }

  const [destinationTokenAccount] = await findAssociatedTokenPda({
    owner: destination,
    tokenProgram,
    mint,
  });

  const signers = getDeduplicatedSigners(
    [creator].concat(additionalVoters ?? [])
  );

  const remainingAccounts = signers
    .filter((x) => !(x instanceof Secp256r1Key))
    .map(
      (x) =>
        ({
          address: (x as TransactionSigner).address,
          signer: x,
          role: AccountRole.READONLY_SIGNER,
        }) as IAccountSignerMeta
    );

  const {
    slotHashSysvar,
    instructionsSysvar,
    domainConfig,
    verifyArgs,
    message,
    signature,
    publicKey,
  } = await extractSecp256r1VerificationArgs(
    signers.find((x) => x instanceof Secp256r1Key)
  );
  const instructions: IInstruction[] = [];
  if (message && signature && publicKey) {
    instructions.push(
      getSecp256r1VerifyInstruction({
        payload: [
          {
            message,
            signature,
            publicKey,
          },
        ],
      })
    );
  }

  instructions.push(
    await getTokenTransferIntentInstructionAsync({
      settings: delegateData.multiWalletSettings,
      domainConfig,
      sourceTokenAccount,
      destination,
      destinationTokenAccount,
      mint,
      amount,
      secp256r1VerifyArgs: verifyArgs,
      instructionsSysvar,
      slotHashSysvar,
      remainingAccounts,
    })
  );
  return instructions;
}
