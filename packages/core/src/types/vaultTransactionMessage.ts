import {
  type CompiledTransactionMessage,
  type CompiledTransactionMessageWithLifetime,
  getAddressCodec,
  getArrayCodec,
  getStructCodec,
  getU8Codec,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { MULTI_WALLET_PROGRAM_ADDRESS } from "../generated";

function getCompiledInstructionCodec() {
  return getStructCodec([
    ["programAddressIndex", getU8Codec()],
    ["accountIndices", getArrayCodec(getU8Codec())],
    ["data", getArrayCodec(getU8Codec())],
  ]);
}

const vaultTransactionMessageCodec = getStructCodec([
  ["numSigners", getU8Codec()],
  ["numWritableSigners", getU8Codec()],
  ["numWritableNonSigners", getU8Codec()],
  ["accountKeys", getArrayCodec(getAddressCodec())],
  ["instructions", getArrayCodec(getCompiledInstructionCodec())],
]);

export function vaultTransactionMessageSerialize(
  compiledMessage: CompiledTransactionMessage & { version: 1 },
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
    instructions: compiledMessage.instructionPayloads.map((ix, index) => {
      return {
        programAddressIndex:
          compiledMessage.instructionHeaders[index].programAccountIndex,
        accountIndices: ix.instructionAccountIndices ?? [],
        data: Array.from(ix.instructionData ?? []),
      };
    }),
  });

  return transactionMessageBytes;
}

export function vaultTransactionMessageDeserialize(
  transactionMessageBytes: ReadonlyUint8Array,
): CompiledTransactionMessage & {
  version: 1;
} & CompiledTransactionMessageWithLifetime {
  const vaultTransactionMessage = vaultTransactionMessageCodec.decode(
    transactionMessageBytes,
  );

  return {
    configMask: 0,
    configValues: [],
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
    instructionHeaders: vaultTransactionMessage.instructions.map((x) => ({
      numInstructionAccounts: x.accountIndices.length ?? 0,
      numInstructionDataBytes: x.data?.length ?? 0,
      programAccountIndex: x.programAddressIndex,
    })),
    instructionPayloads: vaultTransactionMessage.instructions.map((x) => ({
      instructionAccountIndices: x.accountIndices,
      instructionData: new Uint8Array(x.data ?? []),
    })),
    numInstructions: vaultTransactionMessage.instructions.length,
    numStaticAccounts: vaultTransactionMessage.accountKeys.length,
    staticAccounts: vaultTransactionMessage.accountKeys,
    version: 1,
    lifetimeToken: MULTI_WALLET_PROGRAM_ADDRESS,
  };
}
