import {
  type Address,
  type CompiledTransactionMessage,
  type Instruction,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "@solana/kit";
import { getTransactionExecuteSyncInstruction } from "../generated";
import { SignedSecp256r1Key } from "../types";
import { getWalletAddressFromSettings } from "../utils";
import {
  buildSignerAccounts,
  getDeduplicatedSigners,
} from "../utils/transaction/internal";
import { PackedAccounts } from "../utils/transaction/packedAccounts";
import { accountsForTransactionExecute } from "../utils/transactionMessage/internal";
import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyInput,
} from "./secp256r1Verify";

export async function executeTransactionSync({
  settings,
  transactionMessageBytes,
  additionalSigners,
  signers,
  secp256r1VerifyInput = [],
}: {
  settings: Address;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  transactionMessageBytes: ReadonlyUint8Array;
  additionalSigners?: TransactionSigner[];
  secp256r1VerifyInput?: Secp256r1VerifyInput;
}) {
  const dedupSigners = getDeduplicatedSigners(signers);
  const walletAddress = await getWalletAddressFromSettings(settings);
  const [{ accountMetas, transactionMessage }] = await Promise.all([
    accountsForTransactionExecute({
      transactionMessageBytes,
      walletAddress,
      additionalSigners,
    }),
  ]);

  const packedAccounts = new PackedAccounts();
  packedAccounts.addPreAccounts(accountMetas);
  const {
    secp256r1VerifyInput: finalSecp256r1VerifyInput,
    transactionSyncSigners,
  } = buildSignerAccounts(dedupSigners, packedAccounts, secp256r1VerifyInput);

  const { remainingAccounts } = packedAccounts.toAccountMetas();

  const instructions: Instruction[] = [];

  if (finalSecp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(finalSecp256r1VerifyInput));
  }

  const customTransactionMessage = parseTransactionMessage(transactionMessage);

  instructions.push(
    getTransactionExecuteSyncInstruction({
      signers: transactionSyncSigners,
      settings,
      ...customTransactionMessage,
      remainingAccounts,
    }),
  );

  return {
    instructions,
  };
}

function parseTransactionMessage(
  compiledMessage: CompiledTransactionMessage & { version: 1 },
) {
  return {
    numAccountKeys: compiledMessage.numStaticAccounts,
    numSigners: compiledMessage.header.numSignerAccounts,
    numWritableSigners:
      compiledMessage.header.numSignerAccounts -
      compiledMessage.header.numReadonlySignerAccounts,
    numWritableNonSigners:
      compiledMessage.staticAccounts.length -
      compiledMessage.header.numSignerAccounts -
      compiledMessage.header.numReadonlyNonSignerAccounts,
    accountKeys: compiledMessage.staticAccounts,
    instructions: compiledMessage.instructionPayloads.map((ix, index) => {
      return {
        programAddressIndex:
          compiledMessage.instructionHeaders[index].programAccountIndex,
        accountIndices: new Uint8Array(ix.instructionAccountIndices ?? []),
        data: ix.instructionData,
      };
    }),
  };
}
