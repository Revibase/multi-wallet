import {
  type AccountMeta,
  type Address,
  type AddressesByLookupTableAddress,
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
  addressesByLookupTableAddress,
  secp256r1VerifyInput = [],
}: {
  settings: Address;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  transactionMessageBytes: ReadonlyUint8Array;
  additionalSigners?: TransactionSigner[];
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
}) {
  const dedupSigners = getDeduplicatedSigners(signers);
  const walletAddress = await getWalletAddressFromSettings(settings);
  const [{ accountMetas, addressLookupTableAccounts, transactionMessage }] =
    await Promise.all([
      accountsForTransactionExecute({
        transactionMessageBytes,
        walletAddress,
        additionalSigners,
        addressesByLookupTableAddress,
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

  const customTransactionMessage = parseTransactionMessage(
    transactionMessage,
    accountMetas,
  );

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
    addressLookupTableAccounts,
  };
}

function parseTransactionMessage(
  transactionMessage: CompiledTransactionMessage & { version: 0 },
  accountMetas: AccountMeta[],
) {
  return {
    numSigners: transactionMessage.header.numSignerAccounts,
    numWritableNonSigners:
      transactionMessage.staticAccounts.length -
      transactionMessage.header.numSignerAccounts -
      transactionMessage.header.numReadonlyNonSignerAccounts,
    numWritableSigners:
      transactionMessage.header.numSignerAccounts -
      transactionMessage.header.numReadonlySignerAccounts,
    numAccountKeys: transactionMessage.staticAccounts.length,
    instructions: transactionMessage.instructions.map((x) => ({
      ...x,
      accountIndices: new Uint8Array(x.accountIndices ?? []),
      data: (x.data ?? []) as Uint8Array,
    })),
    addressTableLookups:
      transactionMessage.addressTableLookups?.map((x) => ({
        lookupTableAddressIndex: accountMetas.findIndex(
          (y) => y.address === x.lookupTableAddress,
        ),
        writableIndexes: new Uint8Array(x.writableIndexes),
        readonlyIndexes: new Uint8Array(x.readonlyIndexes),
      })) ?? [],
  };
}
