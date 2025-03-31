import * as beet from "@metaplex-foundation/beet";
import * as beetSolana from "@metaplex-foundation/beet-solana";
import { PublicKey } from "@solana/web3.js";

export type CompiledMsInstruction = {
  programIdIndex: number;
  accountIndexes: number[];
  data: number[];
};

export const compiledMsInstructionBeet =
  new beet.FixableBeetArgsStruct<CompiledMsInstruction>(
    [
      ["programIdIndex", beet.u8],
      ["accountIndexes", beet.array(beet.u8)],
      ["data", beet.array(beet.u8)],
    ],
    "CompiledMsInstruction"
  );

export type MessageAddressTableLookup = {
  /** Address lookup table account key */
  accountKey: PublicKey;
  /** List of indexes used to load writable account addresses */
  writableIndexes: number[];
  /** List of indexes used to load readonly account addresses */
  readonlyIndexes: number[];
};

export const messageAddressTableLookupBeet =
  new beet.FixableBeetArgsStruct<MessageAddressTableLookup>(
    [
      ["accountKey", beetSolana.publicKey],
      ["writableIndexes", beet.array(beet.u8)],
      ["readonlyIndexes", beet.array(beet.u8)],
    ],
    "MessageAddressTableLookup"
  );

export type TransactionMessage = {
  numSigners: number;
  numWritableSigners: number;
  numWritableNonSigners: number;
  accountKeys: PublicKey[];
  instructions: CompiledMsInstruction[];
  addressTableLookups: MessageAddressTableLookup[];
};

export const transactionMessageBeet =
  new beet.FixableBeetArgsStruct<TransactionMessage>(
    [
      ["numSigners", beet.u8],
      ["numWritableSigners", beet.u8],
      ["numWritableNonSigners", beet.u8],
      ["accountKeys", beet.array(beetSolana.publicKey)],
      ["instructions", beet.array(compiledMsInstructionBeet)],
      ["addressTableLookups", beet.array(messageAddressTableLookupBeet)],
    ],
    "TransactionMessage"
  );
