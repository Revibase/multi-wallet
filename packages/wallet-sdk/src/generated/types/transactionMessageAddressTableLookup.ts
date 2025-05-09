/**
 * This code was AUTOGENERATED using the codama library.
 * Please DO NOT EDIT THIS FILE, instead use visitors
 * to add features, then rerun codama to update it.
 *
 * @see https://github.com/codama-idl/codama
 */

import {
  addDecoderSizePrefix,
  addEncoderSizePrefix,
  combineCodec,
  getBytesDecoder,
  getBytesEncoder,
  getStructDecoder,
  getStructEncoder,
  getU32Decoder,
  getU32Encoder,
  getU8Decoder,
  getU8Encoder,
  type Codec,
  type Decoder,
  type Encoder,
  type ReadonlyUint8Array,
} from '@solana/kit';

/**
 * Address table lookups describe an on-chain address lookup table to use
 * for loading more readonly and writable accounts in a single tx.
 */

export type TransactionMessageAddressTableLookup = {
  /** Address lookup table account key */
  accountKeyIndex: number;
  /** List of indexes used to load writable account addresses */
  writableIndexes: ReadonlyUint8Array;
  /** List of indexes used to load readonly account addresses */
  readonlyIndexes: ReadonlyUint8Array;
};

export type TransactionMessageAddressTableLookupArgs =
  TransactionMessageAddressTableLookup;

export function getTransactionMessageAddressTableLookupEncoder(): Encoder<TransactionMessageAddressTableLookupArgs> {
  return getStructEncoder([
    ['accountKeyIndex', getU8Encoder()],
    [
      'writableIndexes',
      addEncoderSizePrefix(getBytesEncoder(), getU32Encoder()),
    ],
    [
      'readonlyIndexes',
      addEncoderSizePrefix(getBytesEncoder(), getU32Encoder()),
    ],
  ]);
}

export function getTransactionMessageAddressTableLookupDecoder(): Decoder<TransactionMessageAddressTableLookup> {
  return getStructDecoder([
    ['accountKeyIndex', getU8Decoder()],
    [
      'writableIndexes',
      addDecoderSizePrefix(getBytesDecoder(), getU32Decoder()),
    ],
    [
      'readonlyIndexes',
      addDecoderSizePrefix(getBytesDecoder(), getU32Decoder()),
    ],
  ]);
}

export function getTransactionMessageAddressTableLookupCodec(): Codec<
  TransactionMessageAddressTableLookupArgs,
  TransactionMessageAddressTableLookup
> {
  return combineCodec(
    getTransactionMessageAddressTableLookupEncoder(),
    getTransactionMessageAddressTableLookupDecoder()
  );
}
