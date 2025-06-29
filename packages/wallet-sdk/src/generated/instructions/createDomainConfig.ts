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
  fixDecoderSize,
  fixEncoderSize,
  getAddressDecoder,
  getAddressEncoder,
  getBytesDecoder,
  getBytesEncoder,
  getStructDecoder,
  getStructEncoder,
  getU32Decoder,
  getU32Encoder,
  getUtf8Decoder,
  getUtf8Encoder,
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
  type ReadonlyAccount,
  type ReadonlyUint8Array,
  type TransactionSigner,
  type WritableAccount,
  type WritableSignerAccount,
} from '@solana/kit';
import { MULTI_WALLET_PROGRAM_ADDRESS } from '../programs';
import { getAccountMetaFactory, type ResolvedAccount } from '../shared';

export const CREATE_DOMAIN_CONFIG_DISCRIMINATOR = new Uint8Array([
  197, 81, 191, 2, 164, 140, 184, 90,
]);

export function getCreateDomainConfigDiscriminatorBytes() {
  return fixEncoderSize(getBytesEncoder(), 8).encode(
    CREATE_DOMAIN_CONFIG_DISCRIMINATOR
  );
}

export type CreateDomainConfigInstruction<
  TProgram extends string = typeof MULTI_WALLET_PROGRAM_ADDRESS,
  TAccountDomainConfig extends string | IAccountMeta<string> = string,
  TAccountPayer extends string | IAccountMeta<string> = string,
  TAccountSystemProgram extends
    | string
    | IAccountMeta<string> = '11111111111111111111111111111111',
  TRemainingAccounts extends readonly IAccountMeta<string>[] = [],
> = IInstruction<TProgram> &
  IInstructionWithData<Uint8Array> &
  IInstructionWithAccounts<
    [
      TAccountDomainConfig extends string
        ? WritableAccount<TAccountDomainConfig>
        : TAccountDomainConfig,
      TAccountPayer extends string
        ? WritableSignerAccount<TAccountPayer> &
            IAccountSignerMeta<TAccountPayer>
        : TAccountPayer,
      TAccountSystemProgram extends string
        ? ReadonlyAccount<TAccountSystemProgram>
        : TAccountSystemProgram,
      ...TRemainingAccounts,
    ]
  >;

export type CreateDomainConfigInstructionData = {
  discriminator: ReadonlyUint8Array;
  rpId: string;
  rpIdHash: ReadonlyUint8Array;
  origin: string;
  authority: Address;
};

export type CreateDomainConfigInstructionDataArgs = {
  rpId: string;
  rpIdHash: ReadonlyUint8Array;
  origin: string;
  authority: Address;
};

export function getCreateDomainConfigInstructionDataEncoder(): Encoder<CreateDomainConfigInstructionDataArgs> {
  return transformEncoder(
    getStructEncoder([
      ['discriminator', fixEncoderSize(getBytesEncoder(), 8)],
      ['rpId', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
      ['rpIdHash', fixEncoderSize(getBytesEncoder(), 32)],
      ['origin', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
      ['authority', getAddressEncoder()],
    ]),
    (value) => ({ ...value, discriminator: CREATE_DOMAIN_CONFIG_DISCRIMINATOR })
  );
}

export function getCreateDomainConfigInstructionDataDecoder(): Decoder<CreateDomainConfigInstructionData> {
  return getStructDecoder([
    ['discriminator', fixDecoderSize(getBytesDecoder(), 8)],
    ['rpId', addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder())],
    ['rpIdHash', fixDecoderSize(getBytesDecoder(), 32)],
    ['origin', addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder())],
    ['authority', getAddressDecoder()],
  ]);
}

export function getCreateDomainConfigInstructionDataCodec(): Codec<
  CreateDomainConfigInstructionDataArgs,
  CreateDomainConfigInstructionData
> {
  return combineCodec(
    getCreateDomainConfigInstructionDataEncoder(),
    getCreateDomainConfigInstructionDataDecoder()
  );
}

export type CreateDomainConfigInput<
  TAccountDomainConfig extends string = string,
  TAccountPayer extends string = string,
  TAccountSystemProgram extends string = string,
> = {
  domainConfig: Address<TAccountDomainConfig>;
  payer: TransactionSigner<TAccountPayer>;
  systemProgram?: Address<TAccountSystemProgram>;
  rpId: CreateDomainConfigInstructionDataArgs['rpId'];
  rpIdHash: CreateDomainConfigInstructionDataArgs['rpIdHash'];
  origin: CreateDomainConfigInstructionDataArgs['origin'];
  authority: CreateDomainConfigInstructionDataArgs['authority'];
};

export function getCreateDomainConfigInstruction<
  TAccountDomainConfig extends string,
  TAccountPayer extends string,
  TAccountSystemProgram extends string,
  TProgramAddress extends Address = typeof MULTI_WALLET_PROGRAM_ADDRESS,
>(
  input: CreateDomainConfigInput<
    TAccountDomainConfig,
    TAccountPayer,
    TAccountSystemProgram
  >,
  config?: { programAddress?: TProgramAddress }
): CreateDomainConfigInstruction<
  TProgramAddress,
  TAccountDomainConfig,
  TAccountPayer,
  TAccountSystemProgram
> {
  // Program address.
  const programAddress = config?.programAddress ?? MULTI_WALLET_PROGRAM_ADDRESS;

  // Original accounts.
  const originalAccounts = {
    domainConfig: { value: input.domainConfig ?? null, isWritable: true },
    payer: { value: input.payer ?? null, isWritable: true },
    systemProgram: { value: input.systemProgram ?? null, isWritable: false },
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

  const getAccountMeta = getAccountMetaFactory(programAddress, 'programId');
  const instruction = {
    accounts: [
      getAccountMeta(accounts.domainConfig),
      getAccountMeta(accounts.payer),
      getAccountMeta(accounts.systemProgram),
    ],
    programAddress,
    data: getCreateDomainConfigInstructionDataEncoder().encode(
      args as CreateDomainConfigInstructionDataArgs
    ),
  } as CreateDomainConfigInstruction<
    TProgramAddress,
    TAccountDomainConfig,
    TAccountPayer,
    TAccountSystemProgram
  >;

  return instruction;
}

export type ParsedCreateDomainConfigInstruction<
  TProgram extends string = typeof MULTI_WALLET_PROGRAM_ADDRESS,
  TAccountMetas extends readonly IAccountMeta[] = readonly IAccountMeta[],
> = {
  programAddress: Address<TProgram>;
  accounts: {
    domainConfig: TAccountMetas[0];
    payer: TAccountMetas[1];
    systemProgram: TAccountMetas[2];
  };
  data: CreateDomainConfigInstructionData;
};

export function parseCreateDomainConfigInstruction<
  TProgram extends string,
  TAccountMetas extends readonly IAccountMeta[],
>(
  instruction: IInstruction<TProgram> &
    IInstructionWithAccounts<TAccountMetas> &
    IInstructionWithData<Uint8Array>
): ParsedCreateDomainConfigInstruction<TProgram, TAccountMetas> {
  if (instruction.accounts.length < 3) {
    // TODO: Coded error.
    throw new Error('Not enough accounts');
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
      domainConfig: getNextAccount(),
      payer: getNextAccount(),
      systemProgram: getNextAccount(),
    },
    data: getCreateDomainConfigInstructionDataDecoder().decode(
      instruction.data
    ),
  };
}
