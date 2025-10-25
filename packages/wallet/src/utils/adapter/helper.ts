import {
  type AddressesByLookupTableAddress,
  type ReadonlyUint8Array,
  type TransactionSigner,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  getBlockhashDecoder,
  pipe,
  prependTransactionMessageInstructions,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "gill";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "gill/programs";
import { prepareTransactionSync } from "../../transaction";
import { Secp256r1Key } from "../../types";

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return arraysEqual(a, b);
}
interface Indexed<T> {
  length: number;
  [index: number]: T;
}

function arraysEqual<T>(a: Indexed<T>, b: Indexed<T>): boolean {
  if (a === b) return true;

  const length = a.length;
  if (length !== b.length) return false;

  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

export function createSignInMessageText(input: {
  domain: string;
  nonce: string;
}): string {
  let message = `${input.domain} wants you to sign in with your Solana account`;

  const fields: string[] = [];

  if (input.nonce) {
    fields.push(`Nonce: ${input.nonce}`);
  }
  if (fields.length) {
    message += `\n\n${fields.join("\n")}`;
  }

  return message;
}

export function simulateSecp256r1Signer() {
  const randomPubkey = crypto.getRandomValues(new Uint8Array(33));
  const signer = new Secp256r1Key(randomPubkey, {
    authData: crypto.getRandomValues(new Uint8Array(37)),
    domainConfig: getAddressDecoder().decode(
      crypto.getRandomValues(new Uint8Array(32))
    ),
    signature: crypto.getRandomValues(new Uint8Array(64)),
    verifyArgs: {
      slotHash: crypto.getRandomValues(new Uint8Array(32)),
      slotNumber: BigInt(0),
      clientDataJson: crypto.getRandomValues(new Uint8Array(250)), // can range from 137 up to 247 (just set it as 250 to be safe)
    },
  });
  return signer;
}

export async function estimateTransactionSizeExceedLimit({
  payer,
  settingsIndex,
  transactionMessageBytes,
  signers,
  compressed,
  addressesByLookupTableAddress,
  cachedAccounts,
}: {
  payer: TransactionSigner;
  transactionMessageBytes: ReadonlyUint8Array;
  settingsIndex: number;
  compressed: boolean;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  signers: (TransactionSigner | Secp256r1Key)[];
  cachedAccounts?: Map<string, any>;
}) {
  const result = await prepareTransactionSync({
    payer,
    index: settingsIndex,
    transactionMessageBytes,
    signers,
    compressed,
    simulateProof: true,
    addressesByLookupTableAddress,
    cachedAccounts,
  });

  const tx = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => appendTransactionMessageInstructions(result.ixs, tx),
    (tx) => setTransactionMessageFeePayerSigner(result.payer, tx),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: getBlockhashDecoder().decode(
            crypto.getRandomValues(new Uint8Array(32))
          ),
          lastValidBlockHeight: BigInt(Number.MAX_SAFE_INTEGER),
        },
        tx
      ),
    (tx) =>
      result.addressLookupTableAccounts
        ? compressTransactionMessageUsingAddressLookupTables(
            tx,
            result.addressLookupTableAccounts
          )
        : tx,
    (tx) =>
      prependTransactionMessageInstructions(
        [
          getSetComputeUnitLimitInstruction({
            units: 800_000,
          }),
          getSetComputeUnitPriceInstruction({
            microLamports: 1000,
          }),
        ],
        tx
      ),

    (tx) => compileTransaction(tx)
  );
  const txSize = getBase64EncodedWireTransaction(tx).length;
  console.log("Estimated Tx Size: ", txSize);
  return txSize > 1644;
}
