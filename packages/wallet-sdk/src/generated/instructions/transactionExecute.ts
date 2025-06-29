/**
 * This code was AUTOGENERATED using the codama library.
 * Please DO NOT EDIT THIS FILE, instead use visitors
 * to add features, then rerun codama to update it.
 *
 * @see https://github.com/codama-idl/codama
 */

import {
  combineCodec,
  fixDecoderSize,
  fixEncoderSize,
  getBytesDecoder,
  getBytesEncoder,
  getStructDecoder,
  getStructEncoder,
  transformEncoder,
  type Address,
  type Codec,
  type Decoder,
  type Encoder,
  type IAccountMeta,
  type IInstruction,
  type IInstructionWithAccounts,
  type IInstructionWithData,
  type ReadonlyUint8Array,
  type WritableAccount,
} from "@solana/kit";
import { MULTI_WALLET_PROGRAM_ADDRESS } from "../programs";
import { getAccountMetaFactory, type ResolvedAccount } from "../shared";

export const TRANSACTION_EXECUTE_DISCRIMINATOR = new Uint8Array([
  93, 171, 78, 134, 252, 84, 186, 189,
]);

export function getTransactionExecuteDiscriminatorBytes() {
  return fixEncoderSize(getBytesEncoder(), 8).encode(
    TRANSACTION_EXECUTE_DISCRIMINATOR
  );
}

export type TransactionExecuteInstruction<
  TProgram extends string = typeof MULTI_WALLET_PROGRAM_ADDRESS,
  TAccountSettings extends string | IAccountMeta<string> = string,
  TAccountPayer extends string | IAccountMeta<string> = string,
  TAccountTransactionBuffer extends string | IAccountMeta<string> = string,
  TRemainingAccounts extends readonly IAccountMeta<string>[] = [],
> = IInstruction<TProgram> &
  IInstructionWithData<Uint8Array> &
  IInstructionWithAccounts<
    [
      TAccountSettings extends string
        ? WritableAccount<TAccountSettings>
        : TAccountSettings,
      TAccountPayer extends string
        ? WritableAccount<TAccountPayer>
        : TAccountPayer,
      TAccountTransactionBuffer extends string
        ? WritableAccount<TAccountTransactionBuffer>
        : TAccountTransactionBuffer,
      ...TRemainingAccounts,
    ]
  >;

export type TransactionExecuteInstructionData = {
  discriminator: ReadonlyUint8Array;
};

export type TransactionExecuteInstructionDataArgs = {};

export function getTransactionExecuteInstructionDataEncoder(): Encoder<TransactionExecuteInstructionDataArgs> {
  return transformEncoder(
    getStructEncoder([["discriminator", fixEncoderSize(getBytesEncoder(), 8)]]),
    (value) => ({ ...value, discriminator: TRANSACTION_EXECUTE_DISCRIMINATOR })
  );
}

export function getTransactionExecuteInstructionDataDecoder(): Decoder<TransactionExecuteInstructionData> {
  return getStructDecoder([
    ["discriminator", fixDecoderSize(getBytesDecoder(), 8)],
  ]);
}

export function getTransactionExecuteInstructionDataCodec(): Codec<
  TransactionExecuteInstructionDataArgs,
  TransactionExecuteInstructionData
> {
  return combineCodec(
    getTransactionExecuteInstructionDataEncoder(),
    getTransactionExecuteInstructionDataDecoder()
  );
}

export type TransactionExecuteInput<
  TAccountSettings extends string = string,
  TAccountPayer extends string = string,
  TAccountTransactionBuffer extends string = string,
  TRemainingAccounts extends readonly IAccountMeta<string>[] = [],
> = {
  settings: Address<TAccountSettings>;
  payer: Address<TAccountPayer>;
  transactionBuffer: Address<TAccountTransactionBuffer>;
  remainingAccounts: TRemainingAccounts;
};

export function getTransactionExecuteInstruction<
  TAccountSettings extends string,
  TAccountPayer extends string,
  TAccountTransactionBuffer extends string,
  TProgramAddress extends Address = typeof MULTI_WALLET_PROGRAM_ADDRESS,
  TRemainingAccounts extends readonly IAccountMeta<string>[] = [],
>(
  input: TransactionExecuteInput<
    TAccountSettings,
    TAccountPayer,
    TAccountTransactionBuffer,
    TRemainingAccounts
  >,
  config?: { programAddress?: TProgramAddress }
): TransactionExecuteInstruction<
  TProgramAddress,
  TAccountSettings,
  TAccountPayer,
  TAccountTransactionBuffer,
  TRemainingAccounts
> {
  // Program address.
  const programAddress = config?.programAddress ?? MULTI_WALLET_PROGRAM_ADDRESS;

  // Original accounts.
  const originalAccounts = {
    settings: { value: input.settings ?? null, isWritable: true },
    payer: { value: input.payer ?? null, isWritable: true },
    transactionBuffer: {
      value: input.transactionBuffer ?? null,
      isWritable: true,
    },
  };
  const accounts = originalAccounts as Record<
    keyof typeof originalAccounts,
    ResolvedAccount
  >;

  const getAccountMeta = getAccountMetaFactory(programAddress, "programId");
  const instruction = {
    accounts: [
      getAccountMeta(accounts.settings),
      getAccountMeta(accounts.payer),
      getAccountMeta(accounts.transactionBuffer),
      ...input.remainingAccounts,
    ],
    programAddress,
    data: getTransactionExecuteInstructionDataEncoder().encode({}),
  } as TransactionExecuteInstruction<
    TProgramAddress,
    TAccountSettings,
    TAccountPayer,
    TAccountTransactionBuffer,
    TRemainingAccounts
  >;

  return instruction;
}

export type ParsedTransactionExecuteInstruction<
  TProgram extends string = typeof MULTI_WALLET_PROGRAM_ADDRESS,
  TAccountMetas extends readonly IAccountMeta[] = readonly IAccountMeta[],
> = {
  programAddress: Address<TProgram>;
  accounts: {
    settings: TAccountMetas[0];
    payer: TAccountMetas[1];
    transactionBuffer: TAccountMetas[2];
  };
  data: TransactionExecuteInstructionData;
};

export function parseTransactionExecuteInstruction<
  TProgram extends string,
  TAccountMetas extends readonly IAccountMeta[],
>(
  instruction: IInstruction<TProgram> &
    IInstructionWithAccounts<TAccountMetas> &
    IInstructionWithData<Uint8Array>
): ParsedTransactionExecuteInstruction<TProgram, TAccountMetas> {
  if (instruction.accounts.length < 3) {
    // TODO: Coded error.
    throw new Error("Not enough accounts");
  }
  let accountIndex = 0;
  const getNextAccount = () => {
    const accountMeta = instruction.accounts![accountIndex]!;
    accountIndex += 1;
    return accountMeta;
  };
  return {
    programAddress: instruction.programAddress,
    accounts: {
      settings: getNextAccount(),
      payer: getNextAccount(),
      transactionBuffer: getNextAccount(),
    },
    data: getTransactionExecuteInstructionDataDecoder().decode(
      instruction.data
    ),
  };
}
