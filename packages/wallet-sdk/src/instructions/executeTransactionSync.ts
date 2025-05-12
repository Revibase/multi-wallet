import {
  Address,
  GetMultipleAccountsApi,
  IInstruction,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
import { getTransactionExecuteSyncInstruction } from "../generated";
import { Secp256r1Key } from "../types";
import { getMultiWalletFromSettings } from "../utils";
import {
  accountsForTransactionExecute,
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../utils/internal";
import { getSecp256r1VerifyInstruction } from "./secp256r1Verify";

export async function executeTransactionSync({
  rpc,
  settings,
  transactionMessageBytes,
  signers,
}: {
  rpc: Rpc<GetMultipleAccountsApi>;
  settings: Address;
  signers: (TransactionSigner | Secp256r1Key)[];
  transactionMessageBytes: Uint8Array;
}) {
  const dedupSigners = getDeduplicatedSigners(signers);

  const multiWallet = await getMultiWalletFromSettings(settings);

  const { accountMetas, addressLookupTableAccounts, transactionMessage } =
    await accountsForTransactionExecute({
      rpc,
      transactionMessageBytes,
      multiWallet,
      additionalSigners: dedupSigners.filter(
        (x) => !(x instanceof Secp256r1Key)
      ) as TransactionSigner[],
    });
  const {
    slotHashSysvar,
    domainConfig,
    verifyArgs,
    instructionsSysvar,
    signature,
    publicKey,
    message,
  } = await extractSecp256r1VerificationArgs(
    dedupSigners.find((x) => x instanceof Secp256r1Key)
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
    getTransactionExecuteSyncInstruction({
      instructionsSysvar,
      domainConfig,
      slotHashSysvar,
      secp256r1VerifyArgs: verifyArgs,
      settings,
      numSigners: transactionMessage.numSigners,
      numWritableSigners: transactionMessage.numWritableSigners,
      numWritableNonSigners: transactionMessage.numWritableNonSigners,
      numAccountKeys: transactionMessage.accountKeys.length,
      instructions: transactionMessage.instructions.map((x) => ({
        programIdIndex: x.programIdIndex,
        accountIndexes: new Uint8Array(x.accountIndexes),
        data: new Uint8Array(x.data),
      })),
      addressTableLookups: transactionMessage.addressTableLookups.map((x) => ({
        accountKeyIndex: accountMetas.findIndex(
          (y) => y.address === x.accountKey
        ),
        writableIndexes: new Uint8Array(x.writableIndexes),
        readonlyIndexes: new Uint8Array(x.readonlyIndexes),
      })),
      remainingAccounts: accountMetas,
    })
  );

  return {
    instructions,
    addressLookupTableAccounts,
  };
}
