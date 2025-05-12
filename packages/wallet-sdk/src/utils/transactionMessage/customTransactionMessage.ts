import {
  Address,
  CompiledTransactionMessage,
  getAddressCodec,
  getArrayCodec,
  getStructCodec,
  getU8Codec,
} from "@solana/kit";

function getMultiWalletInstructionCodec() {
  return getStructCodec([
    ["programIdIndex", getU8Codec()],
    ["accountIndexes", getArrayCodec(getU8Codec())],
    ["data", getArrayCodec(getU8Codec())],
  ]);
}

function getMultiWalletAddressTableLookUpCodec() {
  return getStructCodec([
    ["accountKey", getAddressCodec()],
    ["writableIndexes", getArrayCodec(getU8Codec())],
    ["readonlyIndexes", getArrayCodec(getU8Codec())],
  ]);
}

const transactionMessageCodec = getStructCodec([
  ["numSigners", getU8Codec()],
  ["numWritableSigners", getU8Codec()],
  ["numWritableNonSigners", getU8Codec()],
  ["accountKeys", getArrayCodec(getAddressCodec())],
  ["instructions", getArrayCodec(getMultiWalletInstructionCodec())],
  [
    "addressTableLookups",
    getArrayCodec(getMultiWalletAddressTableLookUpCodec()),
  ],
]);

export type CompiledMsInstruction = {
  programIdIndex: number;
  accountIndexes: number[];
  data: number[];
};
export type MessageAddressTableLookup = {
  /** Address lookup table account key */
  accountKey: Address;
  /** List of indexes used to load writable account addresses */
  writableIndexes: number[];
  /** List of indexes used to load readonly account addresses */
  readonlyIndexes: number[];
};

export interface CustomTransactionMessage {
  numSigners: number;
  numWritableSigners: number;
  numWritableNonSigners: number;
  accountKeys: Address[];
  instructions: CompiledMsInstruction[];
  addressTableLookups: MessageAddressTableLookup[];
}
export function customTransactionMessageSerialize(
  compiledMessage: CompiledTransactionMessage
) {
  const transactionMessageBytes = transactionMessageCodec.encode({
    numSigners: compiledMessage.header.numSignerAccounts,
    numWritableSigners:
      compiledMessage.header.numSignerAccounts -
      compiledMessage.header.numReadonlySignerAccounts,
    numWritableNonSigners:
      compiledMessage.staticAccounts.length -
      compiledMessage.header.numSignerAccounts -
      compiledMessage.header.numReadonlyNonSignerAccounts,
    accountKeys: compiledMessage.staticAccounts,
    instructions: compiledMessage.instructions.map((ix) => {
      return {
        programIdIndex: ix.programAddressIndex,
        accountIndexes: ix.accountIndices ?? [],
        data: Array.from(ix.data ?? []),
      };
    }),
    addressTableLookups:
      compiledMessage.version !== "legacy"
        ? (compiledMessage.addressTableLookups?.map((x) => ({
            accountKey: x.lookupTableAddress,
            readonlyIndexes: x.readableIndices as number[],
            writableIndexes: x.writableIndices as number[],
          })) ?? [])
        : [],
  });

  return transactionMessageBytes;
}

export function customTransactionMessageDeserialize(
  compiledMessage: Uint8Array
): CustomTransactionMessage {
  return transactionMessageCodec.decode(compiledMessage);
}
