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
  assertAccountExists,
  assertAccountsExist,
  combineCodec,
  decodeAccount,
  fetchEncodedAccount,
  fetchEncodedAccounts,
  fixDecoderSize,
  fixEncoderSize,
  getAddressDecoder,
  getAddressEncoder,
  getArrayDecoder,
  getArrayEncoder,
  getBooleanDecoder,
  getBooleanEncoder,
  getBytesDecoder,
  getBytesEncoder,
  getStructDecoder,
  getStructEncoder,
  getU16Decoder,
  getU16Encoder,
  getU32Decoder,
  getU32Encoder,
  getU64Decoder,
  getU64Encoder,
  getU8Decoder,
  getU8Encoder,
  transformEncoder,
  type Account,
  type Address,
  type Codec,
  type Decoder,
  type EncodedAccount,
  type Encoder,
  type FetchAccountConfig,
  type FetchAccountsConfig,
  type MaybeAccount,
  type MaybeEncodedAccount,
  type ReadonlyUint8Array,
} from '@solana/kit';
import {
  getMemberKeyDecoder,
  getMemberKeyEncoder,
  type MemberKey,
  type MemberKeyArgs,
} from '../types';

export const TRANSACTION_BUFFER_DISCRIMINATOR = new Uint8Array([
  90, 36, 35, 219, 93, 225, 110, 96,
]);

export function getTransactionBufferDiscriminatorBytes() {
  return fixEncoderSize(getBytesEncoder(), 8).encode(
    TRANSACTION_BUFFER_DISCRIMINATOR
  );
}

export type TransactionBuffer = {
  discriminator: ReadonlyUint8Array;
  /** The multisig settings this belongs to. */
  multiWalletSettings: Address;
  /** The bump for the multi_wallet */
  multiWalletBump: number;
  /** Flag to allow transaction to be executed */
  canExecute: boolean;
  /** Flag to allow execution without sigverify once sufficient threshold is met */
  permissionlessExecution: boolean;
  expiry: bigint;
  /** Payer for the transaction buffer */
  payer: Address;
  /** transaction bump */
  bump: number;
  /** Index to seed address derivation */
  bufferIndex: number;
  /** Hash of the final assembled transaction message. */
  finalBufferHash: ReadonlyUint8Array;
  /** The size of the final assembled transaction message. */
  finalBufferSize: number;
  /** Member of the Multisig who created the TransactionBuffer. */
  creator: MemberKey;
  /** Buffer hash for all the buffer extend instruction */
  bufferExtendHashes: Array<ReadonlyUint8Array>;
  /** Members that voted for this transaction */
  voters: Array<MemberKey>;
  /** The buffer of the transaction message. */
  buffer: ReadonlyUint8Array;
};

export type TransactionBufferArgs = {
  /** The multisig settings this belongs to. */
  multiWalletSettings: Address;
  /** The bump for the multi_wallet */
  multiWalletBump: number;
  /** Flag to allow transaction to be executed */
  canExecute: boolean;
  /** Flag to allow execution without sigverify once sufficient threshold is met */
  permissionlessExecution: boolean;
  expiry: number | bigint;
  /** Payer for the transaction buffer */
  payer: Address;
  /** transaction bump */
  bump: number;
  /** Index to seed address derivation */
  bufferIndex: number;
  /** Hash of the final assembled transaction message. */
  finalBufferHash: ReadonlyUint8Array;
  /** The size of the final assembled transaction message. */
  finalBufferSize: number;
  /** Member of the Multisig who created the TransactionBuffer. */
  creator: MemberKeyArgs;
  /** Buffer hash for all the buffer extend instruction */
  bufferExtendHashes: Array<ReadonlyUint8Array>;
  /** Members that voted for this transaction */
  voters: Array<MemberKeyArgs>;
  /** The buffer of the transaction message. */
  buffer: ReadonlyUint8Array;
};

export function getTransactionBufferEncoder(): Encoder<TransactionBufferArgs> {
  return transformEncoder(
    getStructEncoder([
      ['discriminator', fixEncoderSize(getBytesEncoder(), 8)],
      ['multiWalletSettings', getAddressEncoder()],
      ['multiWalletBump', getU8Encoder()],
      ['canExecute', getBooleanEncoder()],
      ['permissionlessExecution', getBooleanEncoder()],
      ['expiry', getU64Encoder()],
      ['payer', getAddressEncoder()],
      ['bump', getU8Encoder()],
      ['bufferIndex', getU8Encoder()],
      ['finalBufferHash', fixEncoderSize(getBytesEncoder(), 32)],
      ['finalBufferSize', getU16Encoder()],
      ['creator', getMemberKeyEncoder()],
      [
        'bufferExtendHashes',
        getArrayEncoder(fixEncoderSize(getBytesEncoder(), 32)),
      ],
      ['voters', getArrayEncoder(getMemberKeyEncoder())],
      ['buffer', addEncoderSizePrefix(getBytesEncoder(), getU32Encoder())],
    ]),
    (value) => ({ ...value, discriminator: TRANSACTION_BUFFER_DISCRIMINATOR })
  );
}

export function getTransactionBufferDecoder(): Decoder<TransactionBuffer> {
  return getStructDecoder([
    ['discriminator', fixDecoderSize(getBytesDecoder(), 8)],
    ['multiWalletSettings', getAddressDecoder()],
    ['multiWalletBump', getU8Decoder()],
    ['canExecute', getBooleanDecoder()],
    ['permissionlessExecution', getBooleanDecoder()],
    ['expiry', getU64Decoder()],
    ['payer', getAddressDecoder()],
    ['bump', getU8Decoder()],
    ['bufferIndex', getU8Decoder()],
    ['finalBufferHash', fixDecoderSize(getBytesDecoder(), 32)],
    ['finalBufferSize', getU16Decoder()],
    ['creator', getMemberKeyDecoder()],
    [
      'bufferExtendHashes',
      getArrayDecoder(fixDecoderSize(getBytesDecoder(), 32)),
    ],
    ['voters', getArrayDecoder(getMemberKeyDecoder())],
    ['buffer', addDecoderSizePrefix(getBytesDecoder(), getU32Decoder())],
  ]);
}

export function getTransactionBufferCodec(): Codec<
  TransactionBufferArgs,
  TransactionBuffer
> {
  return combineCodec(
    getTransactionBufferEncoder(),
    getTransactionBufferDecoder()
  );
}

export function decodeTransactionBuffer<TAddress extends string = string>(
  encodedAccount: EncodedAccount<TAddress>
): Account<TransactionBuffer, TAddress>;
export function decodeTransactionBuffer<TAddress extends string = string>(
  encodedAccount: MaybeEncodedAccount<TAddress>
): MaybeAccount<TransactionBuffer, TAddress>;
export function decodeTransactionBuffer<TAddress extends string = string>(
  encodedAccount: EncodedAccount<TAddress> | MaybeEncodedAccount<TAddress>
):
  | Account<TransactionBuffer, TAddress>
  | MaybeAccount<TransactionBuffer, TAddress> {
  return decodeAccount(
    encodedAccount as MaybeEncodedAccount<TAddress>,
    getTransactionBufferDecoder()
  );
}

export async function fetchTransactionBuffer<TAddress extends string = string>(
  rpc: Parameters<typeof fetchEncodedAccount>[0],
  address: Address<TAddress>,
  config?: FetchAccountConfig
): Promise<Account<TransactionBuffer, TAddress>> {
  const maybeAccount = await fetchMaybeTransactionBuffer(rpc, address, config);
  assertAccountExists(maybeAccount);
  return maybeAccount;
}

export async function fetchMaybeTransactionBuffer<
  TAddress extends string = string,
>(
  rpc: Parameters<typeof fetchEncodedAccount>[0],
  address: Address<TAddress>,
  config?: FetchAccountConfig
): Promise<MaybeAccount<TransactionBuffer, TAddress>> {
  const maybeAccount = await fetchEncodedAccount(rpc, address, config);
  return decodeTransactionBuffer(maybeAccount);
}

export async function fetchAllTransactionBuffer(
  rpc: Parameters<typeof fetchEncodedAccounts>[0],
  addresses: Array<Address>,
  config?: FetchAccountsConfig
): Promise<Account<TransactionBuffer>[]> {
  const maybeAccounts = await fetchAllMaybeTransactionBuffer(
    rpc,
    addresses,
    config
  );
  assertAccountsExist(maybeAccounts);
  return maybeAccounts;
}

export async function fetchAllMaybeTransactionBuffer(
  rpc: Parameters<typeof fetchEncodedAccounts>[0],
  addresses: Array<Address>,
  config?: FetchAccountsConfig
): Promise<MaybeAccount<TransactionBuffer>[]> {
  const maybeAccounts = await fetchEncodedAccounts(rpc, addresses, config);
  return maybeAccounts.map((maybeAccount) =>
    decodeTransactionBuffer(maybeAccount)
  );
}
