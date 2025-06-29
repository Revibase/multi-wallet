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
  getOptionDecoder,
  getOptionEncoder,
  getStructDecoder,
  getStructEncoder,
  transformEncoder,
  type Address,
  type Codec,
  type Decoder,
  type Encoder,
  type IAccountMeta,
  type IAccountSignerMeta,
  type IInstruction,
  type IInstructionWithAccounts,
  type IInstructionWithData,
  type Option,
  type OptionOrNullable,
  type ReadonlyAccount,
  type ReadonlySignerAccount,
  type ReadonlyUint8Array,
  type TransactionSigner,
  type WritableAccount,
  type WritableSignerAccount,
} from '@solana/kit';
import { MULTI_WALLET_PROGRAM_ADDRESS } from '../programs';
import { getAccountMetaFactory, type ResolvedAccount } from '../shared';
import {
  getSecp256r1VerifyArgsDecoder,
  getSecp256r1VerifyArgsEncoder,
  type Secp256r1VerifyArgs,
  type Secp256r1VerifyArgsArgs,
} from '../types';

export const TRANSACTION_BUFFER_VOTE_DISCRIMINATOR = new Uint8Array([
  203, 50, 79, 187, 94, 53, 82, 122,
]);

export function getTransactionBufferVoteDiscriminatorBytes() {
  return fixEncoderSize(getBytesEncoder(), 8).encode(
    TRANSACTION_BUFFER_VOTE_DISCRIMINATOR
  );
}

export type TransactionBufferVoteInstruction<
  TProgram extends string = typeof MULTI_WALLET_PROGRAM_ADDRESS,
  TAccountSettings extends string | IAccountMeta<string> = string,
  TAccountPayer extends string | IAccountMeta<string> = string,
  TAccountDomainConfig extends string | IAccountMeta<string> = string,
  TAccountTransactionBuffer extends string | IAccountMeta<string> = string,
  TAccountVoter extends string | IAccountMeta<string> = string,
  TAccountSystemProgram extends
    | string
    | IAccountMeta<string> = '11111111111111111111111111111111',
  TAccountSlotHashSysvar extends
    | string
    | IAccountMeta<string> = 'SysvarS1otHashes111111111111111111111111111',
  TAccountInstructionsSysvar extends
    | string
    | IAccountMeta<string> = 'Sysvar1nstructions1111111111111111111111111',
  TRemainingAccounts extends readonly IAccountMeta<string>[] = [],
> = IInstruction<TProgram> &
  IInstructionWithData<Uint8Array> &
  IInstructionWithAccounts<
    [
      TAccountSettings extends string
        ? ReadonlyAccount<TAccountSettings>
        : TAccountSettings,
      TAccountPayer extends string
        ? WritableSignerAccount<TAccountPayer> &
            IAccountSignerMeta<TAccountPayer>
        : TAccountPayer,
      TAccountDomainConfig extends string
        ? ReadonlyAccount<TAccountDomainConfig>
        : TAccountDomainConfig,
      TAccountTransactionBuffer extends string
        ? WritableAccount<TAccountTransactionBuffer>
        : TAccountTransactionBuffer,
      TAccountVoter extends string
        ? ReadonlySignerAccount<TAccountVoter> &
            IAccountSignerMeta<TAccountVoter>
        : TAccountVoter,
      TAccountSystemProgram extends string
        ? ReadonlyAccount<TAccountSystemProgram>
        : TAccountSystemProgram,
      TAccountSlotHashSysvar extends string
        ? ReadonlyAccount<TAccountSlotHashSysvar>
        : TAccountSlotHashSysvar,
      TAccountInstructionsSysvar extends string
        ? ReadonlyAccount<TAccountInstructionsSysvar>
        : TAccountInstructionsSysvar,
      ...TRemainingAccounts,
    ]
  >;

export type TransactionBufferVoteInstructionData = {
  discriminator: ReadonlyUint8Array;
  secp256r1VerifyArgs: Option<Secp256r1VerifyArgs>;
};

export type TransactionBufferVoteInstructionDataArgs = {
  secp256r1VerifyArgs: OptionOrNullable<Secp256r1VerifyArgsArgs>;
};

export function getTransactionBufferVoteInstructionDataEncoder(): Encoder<TransactionBufferVoteInstructionDataArgs> {
  return transformEncoder(
    getStructEncoder([
      ['discriminator', fixEncoderSize(getBytesEncoder(), 8)],
      [
        'secp256r1VerifyArgs',
        getOptionEncoder(getSecp256r1VerifyArgsEncoder()),
      ],
    ]),
    (value) => ({
      ...value,
      discriminator: TRANSACTION_BUFFER_VOTE_DISCRIMINATOR,
    })
  );
}

export function getTransactionBufferVoteInstructionDataDecoder(): Decoder<TransactionBufferVoteInstructionData> {
  return getStructDecoder([
    ['discriminator', fixDecoderSize(getBytesDecoder(), 8)],
    ['secp256r1VerifyArgs', getOptionDecoder(getSecp256r1VerifyArgsDecoder())],
  ]);
}

export function getTransactionBufferVoteInstructionDataCodec(): Codec<
  TransactionBufferVoteInstructionDataArgs,
  TransactionBufferVoteInstructionData
> {
  return combineCodec(
    getTransactionBufferVoteInstructionDataEncoder(),
    getTransactionBufferVoteInstructionDataDecoder()
  );
}

export type TransactionBufferVoteInput<
  TAccountSettings extends string = string,
  TAccountPayer extends string = string,
  TAccountDomainConfig extends string = string,
  TAccountTransactionBuffer extends string = string,
  TAccountVoter extends string = string,
  TAccountSystemProgram extends string = string,
  TAccountSlotHashSysvar extends string = string,
  TAccountInstructionsSysvar extends string = string,
> = {
  settings: Address<TAccountSettings>;
  payer: TransactionSigner<TAccountPayer>;
  domainConfig?: Address<TAccountDomainConfig>;
  transactionBuffer: Address<TAccountTransactionBuffer>;
  voter?: TransactionSigner<TAccountVoter>;
  systemProgram?: Address<TAccountSystemProgram>;
  slotHashSysvar?: Address<TAccountSlotHashSysvar>;
  instructionsSysvar?: Address<TAccountInstructionsSysvar>;
  secp256r1VerifyArgs: TransactionBufferVoteInstructionDataArgs['secp256r1VerifyArgs'];
};

export function getTransactionBufferVoteInstruction<
  TAccountSettings extends string,
  TAccountPayer extends string,
  TAccountDomainConfig extends string,
  TAccountTransactionBuffer extends string,
  TAccountVoter extends string,
  TAccountSystemProgram extends string,
  TAccountSlotHashSysvar extends string,
  TAccountInstructionsSysvar extends string,
  TProgramAddress extends Address = typeof MULTI_WALLET_PROGRAM_ADDRESS,
>(
  input: TransactionBufferVoteInput<
    TAccountSettings,
    TAccountPayer,
    TAccountDomainConfig,
    TAccountTransactionBuffer,
    TAccountVoter,
    TAccountSystemProgram,
    TAccountSlotHashSysvar,
    TAccountInstructionsSysvar
  >,
  config?: { programAddress?: TProgramAddress }
): TransactionBufferVoteInstruction<
  TProgramAddress,
  TAccountSettings,
  TAccountPayer,
  TAccountDomainConfig,
  TAccountTransactionBuffer,
  TAccountVoter,
  TAccountSystemProgram,
  TAccountSlotHashSysvar,
  TAccountInstructionsSysvar
> {
  // Program address.
  const programAddress = config?.programAddress ?? MULTI_WALLET_PROGRAM_ADDRESS;

  // Original accounts.
  const originalAccounts = {
    settings: { value: input.settings ?? null, isWritable: false },
    payer: { value: input.payer ?? null, isWritable: true },
    domainConfig: { value: input.domainConfig ?? null, isWritable: false },
    transactionBuffer: {
      value: input.transactionBuffer ?? null,
      isWritable: true,
    },
    voter: { value: input.voter ?? null, isWritable: false },
    systemProgram: { value: input.systemProgram ?? null, isWritable: false },
    slotHashSysvar: { value: input.slotHashSysvar ?? null, isWritable: false },
    instructionsSysvar: {
      value: input.instructionsSysvar ?? null,
      isWritable: false,
    },
  };
  const accounts = originalAccounts as Record<
    keyof typeof originalAccounts,
    ResolvedAccount
  >;

  // Original args.
  const args = { ...input };

  // Resolve default values.
  if (!accounts.systemProgram.value) {
    accounts.systemProgram.value =
      '11111111111111111111111111111111' as Address<'11111111111111111111111111111111'>;
  }
  if (!accounts.slotHashSysvar.value) {
    accounts.slotHashSysvar.value =
      'SysvarS1otHashes111111111111111111111111111' as Address<'SysvarS1otHashes111111111111111111111111111'>;
  }
  if (!accounts.instructionsSysvar.value) {
    accounts.instructionsSysvar.value =
      'Sysvar1nstructions1111111111111111111111111' as Address<'Sysvar1nstructions1111111111111111111111111'>;
  }

  const getAccountMeta = getAccountMetaFactory(programAddress, 'programId');
  const instruction = {
    accounts: [
      getAccountMeta(accounts.settings),
      getAccountMeta(accounts.payer),
      getAccountMeta(accounts.domainConfig),
      getAccountMeta(accounts.transactionBuffer),
      getAccountMeta(accounts.voter),
      getAccountMeta(accounts.systemProgram),
      getAccountMeta(accounts.slotHashSysvar),
      getAccountMeta(accounts.instructionsSysvar),
    ],
    programAddress,
    data: getTransactionBufferVoteInstructionDataEncoder().encode(
      args as TransactionBufferVoteInstructionDataArgs
    ),
  } as TransactionBufferVoteInstruction<
    TProgramAddress,
    TAccountSettings,
    TAccountPayer,
    TAccountDomainConfig,
    TAccountTransactionBuffer,
    TAccountVoter,
    TAccountSystemProgram,
    TAccountSlotHashSysvar,
    TAccountInstructionsSysvar
  >;

  return instruction;
}

export type ParsedTransactionBufferVoteInstruction<
  TProgram extends string = typeof MULTI_WALLET_PROGRAM_ADDRESS,
  TAccountMetas extends readonly IAccountMeta[] = readonly IAccountMeta[],
> = {
  programAddress: Address<TProgram>;
  accounts: {
    settings: TAccountMetas[0];
    payer: TAccountMetas[1];
    domainConfig?: TAccountMetas[2] | undefined;
    transactionBuffer: TAccountMetas[3];
    voter?: TAccountMetas[4] | undefined;
    systemProgram: TAccountMetas[5];
    slotHashSysvar?: TAccountMetas[6] | undefined;
    instructionsSysvar?: TAccountMetas[7] | undefined;
  };
  data: TransactionBufferVoteInstructionData;
};

export function parseTransactionBufferVoteInstruction<
  TProgram extends string,
  TAccountMetas extends readonly IAccountMeta[],
>(
  instruction: IInstruction<TProgram> &
    IInstructionWithAccounts<TAccountMetas> &
    IInstructionWithData<Uint8Array>
): ParsedTransactionBufferVoteInstruction<TProgram, TAccountMetas> {
  if (instruction.accounts.length < 8) {
    // TODO: Coded error.
    throw new Error('Not enough accounts');
  }
  let accountIndex = 0;
  const getNextAccount = () => {
    const accountMeta = instruction.accounts![accountIndex]!;
    accountIndex += 1;
    return accountMeta;
  };
  const getNextOptionalAccount = () => {
    const accountMeta = getNextAccount();
    return accountMeta.address === MULTI_WALLET_PROGRAM_ADDRESS
      ? undefined
      : accountMeta;
  };
  return {
    programAddress: instruction.programAddress,
    accounts: {
      settings: getNextAccount(),
      payer: getNextAccount(),
      domainConfig: getNextOptionalAccount(),
      transactionBuffer: getNextAccount(),
      voter: getNextOptionalAccount(),
      systemProgram: getNextAccount(),
      slotHashSysvar: getNextOptionalAccount(),
      instructionsSysvar: getNextOptionalAccount(),
    },
    data: getTransactionBufferVoteInstructionDataDecoder().decode(
      instruction.data
    ),
  };
}
