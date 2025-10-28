import {
  type CompiledTransactionMessage,
  getAddressCodec,
  getArrayCodec,
  getStructCodec,
  getU8Codec,
  type ReadonlyUint8Array,
} from "gill";
import { MULTI_WALLET_PROGRAM_ADDRESS } from "../generated";

function getCompiledInstructionCodec() {
  return getStructCodec([
    ["programAddressIndex", getU8Codec()],
    ["accountIndices", getArrayCodec(getU8Codec())],
    ["data", getArrayCodec(getU8Codec())],
  ]);
}

function getMessageAddressTableLookupCodec() {
  return getStructCodec([
    ["lookupTableAddress", getAddressCodec()],
    ["writableIndexes", getArrayCodec(getU8Codec())],
    ["readonlyIndexes", getArrayCodec(getU8Codec())],
  ]);
}

const vaultTransactionMessageCodec = getStructCodec([
  ["numSigners", getU8Codec()],
  ["numWritableSigners", getU8Codec()],
  ["numWritableNonSigners", getU8Codec()],
  ["accountKeys", getArrayCodec(getAddressCodec())],
  ["instructions", getArrayCodec(getCompiledInstructionCodec())],
  ["addressTableLookups", getArrayCodec(getMessageAddressTableLookupCodec())],
]);

export function vaultTransactionMessageSerialize(
  compiledMessage: CompiledTransactionMessage
) {
  const transactionMessageBytes = vaultTransactionMessageCodec.encode({
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
        programAddressIndex: ix.programAddressIndex,
        accountIndices: ix.accountIndices ?? [],
        data: Array.from(ix.data ?? []),
      };
    }),
    addressTableLookups:
      compiledMessage.version !== "legacy"
        ? (compiledMessage.addressTableLookups?.map((x) => ({
            lookupTableAddress: x.lookupTableAddress,
            readonlyIndexes: x.readonlyIndexes as number[],
            writableIndexes: x.writableIndexes as number[],
          })) ?? [])
        : [],
  });

  return transactionMessageBytes;
}

export function vaultTransactionMessageDeserialize(
  transactionMessageBytes: ReadonlyUint8Array
): CompiledTransactionMessage {
  const vaultTransactionMessage = vaultTransactionMessageCodec.decode(
    transactionMessageBytes
  );
  return {
    header: {
      numSignerAccounts: vaultTransactionMessage.numSigners,
      numReadonlySignerAccounts:
        vaultTransactionMessage.numSigners -
        vaultTransactionMessage.numWritableSigners,
      numReadonlyNonSignerAccounts:
        vaultTransactionMessage.accountKeys.length -
        vaultTransactionMessage.numSigners -
        vaultTransactionMessage.numWritableNonSigners,
    },
    addressTableLookups: vaultTransactionMessage.addressTableLookups.map(
      (x) => ({
        lookupTableAddress: x.lookupTableAddress,
        readonlyIndexes: x.readonlyIndexes.map(Number),
        writableIndexes: x.writableIndexes.map(Number),
        readableIndices: x.readonlyIndexes.map(Number),
        writableIndices: x.writableIndexes.map(Number),
      })
    ),
    instructions: vaultTransactionMessage.instructions.map((x) => ({
      accountIndices: x.accountIndices.map(Number),
      data: new Uint8Array(x.data),
      programAddressIndex: x.programAddressIndex,
    })),
    lifetimeToken: MULTI_WALLET_PROGRAM_ADDRESS,
    staticAccounts: vaultTransactionMessage.accountKeys,
    version: 0,
  };
}
