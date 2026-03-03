import {
  type CompressedAccount,
  type HashWithTree,
  type ParsedTokenAccount,
  type ValidityProofWithContext,
} from "@lightprotocol/stateless.js";
import { PublicKey } from "@solana/web3.js";
import {
  AccountRole,
  address,
  getAddressEncoder,
  getArrayDecoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  getU64Decoder,
  getU8Encoder,
  getUtf8Encoder,
  none,
  some,
  type Address,
  type Instruction,
  type OptionOrNullable,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "gill";
import {
  getAssociatedTokenAccountAddress,
  getTokenDecoder,
} from "gill/programs";
import { ValidationError } from "../../errors";
import {
  getCompressedSettingsDecoder,
  getExtensionStructDecoder,
  getTokenTransferIntentCompressedInstruction,
  getTokenTransferIntentInstruction,
  type CompressedSettings,
  type CompressedTokenArgsArgs,
  type SettingsMutArgs,
  type SplInterfacePdaArgsArgs,
  type TransactionSyncSignersArgs,
} from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import type { AccountCache } from "../../types/cache";
import {
  getCompressedSettingsAddress,
  getLightProtocolRpc,
  getWalletAddressFromSettings,
} from "../../utils";
import {
  convertToCompressedProofArgs,
  fetchCachedAccountInfo,
  getCompressedAccountHashes,
  getCompressedAccountMutArgs,
  getValidityProofWithRetry,
  getVersionFromDiscriminator,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";
import {
  buildSignerAccounts,
  getDeduplicatedSigners,
} from "../../utils/transaction/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

const compressibleConfig = address(
  "ACXg8a7VaqecBWrSbdu73W4Pg9gsqXJ3EXAqkHyhvVXg",
);
const rentSponsor = address("r18WwUxfG8kQ69bQPAB2jV6zGNKy3GosFGctjQoV4ti");

const ctokenProgramAddress = address(
  "cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m",
);

/** Input parameters for token transfer intent */
export type TokenTransferIntentParams = {
  settings: Address;
  settingsAddressTreeIndex?: number;
  destination: Address;
  mint: Address;
  amount: number | bigint;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  tokenProgram: Address;
  payer: TransactionSigner;
  useDestinationSplAccount?: boolean;
  splInterfacePdaArgs?: SplInterfacePdaArgsArgs;
  compressed?: boolean;
  cachedAccounts?: AccountCache;
};

type HashWithTreeAndAccount = HashWithTree & {
  data: CompressedAccount["data"];
  address: CompressedAccount["address"];
};

type ResolvedAddresses = {
  sourceSplAta: Address;
  sourceCtokenAta: Address;
  destinationSplAta: Address;
  destinationCTokenAta: Address;
  splInterfacePda: Address;
};

type BalancesAndDestinations = {
  splBalance: bigint;
  cTokenBalance: bigint;
  destinationSplTokenAccount: Address | undefined;
  destinationCtokenTokenAccount: Address | undefined;
  requireSplInterface: boolean;
  requireRentSponsor: boolean;
};

export async function tokenTransferIntent({
  settings,
  settingsAddressTreeIndex,
  destination,
  mint,
  signers,
  cachedAccounts,
  amount,
  payer,
  tokenProgram,
  splInterfacePdaArgs = { index: 0, restricted: false },
  compressed = false,
  useDestinationSplAccount = false,
}: TokenTransferIntentParams): Promise<Instruction[]> {
  const dedupSigners = getDeduplicatedSigners(signers);
  const walletAddress = await getWalletAddressFromSettings(settings);

  const addresses = await resolveAddresses(
    mint,
    destination,
    walletAddress,
    tokenProgram,
    splInterfacePdaArgs,
  );

  const [accountInfos, compressedSettings] = await Promise.all([
    fetchAccountInfos(addresses, cachedAccounts),
    getCompressedSettings(
      compressed,
      settings,
      settingsAddressTreeIndex,
      cachedAccounts,
    ),
  ]);

  const balances = computeBalancesAndDestinations(
    accountInfos,
    addresses,
    amount,
    useDestinationSplAccount,
  );

  const [compressedTokenAccount, splInterfaceNeedsInitialization] =
    await Promise.all([
      getCompressedTokenAccount(
        walletAddress,
        mint,
        balances.splBalance,
        balances.cTokenBalance,
        BigInt(amount),
      ),
      checkIfSplInterfaceNeedsToBeInitialized(
        balances.requireSplInterface,
        addresses.splInterfacePda,
        cachedAccounts,
      ),
    ]);

  const compressedTotalBalance = BigInt(
    compressedTokenAccount?.parsed.amount.toNumber() ?? 0,
  );
  if (
    balances.splBalance + balances.cTokenBalance + compressedTotalBalance <
    BigInt(amount)
  ) {
    throw new ValidationError("Insufficient balance for token transfer.");
  }

  const packedAccounts = new PackedAccounts();
  if (splInterfaceNeedsInitialization) {
    packedAccounts.addPreAccounts([
      { address: mint, role: AccountRole.WRITABLE },
    ]);
  }

  const hashesWithTree = buildHashesWithTree(
    compressedTokenAccount,
    compressedSettings,
  );
  const { proof, settingsMutArgs } = await resolveCompressedProofAndSettings(
    packedAccounts,
    hashesWithTree,
    compressedSettings,
  );

  const sourceCompressedTokenAccount = buildSourceCompressedTokenAccounts(
    compressedTokenAccount,
    proof,
    packedAccounts,
  );

  const { secp256r1VerifyInput, transactionSyncSigners } = buildSignerAccounts(
    dedupSigners,
    packedAccounts,
  );

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  const instructions: Instruction[] = [];
  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }

  const commonParams = buildCommonParams({
    amount,
    transactionSyncSigners,
    walletAddress,
    destination,
    addresses,
    balances,
    mint,
    tokenProgram,
    remainingAccounts,
    payer,
    sourceCompressedTokenAccount,
    compressedProofArgs,
    splInterfacePdaArgs,
    delegate: compressedTokenAccount?.parsed.delegate
      ? address(compressedTokenAccount.parsed.delegate.toString())
      : undefined,
  });

  if (compressed) {
    if (!settingsMutArgs) {
      throw new Error("Payer not found or proof args is missing.");
    }
    instructions.push(
      getTokenTransferIntentCompressedInstruction({
        ...commonParams,
        settingsMutArgs,
      }),
    );
  } else {
    instructions.push(
      getTokenTransferIntentInstruction({
        ...commonParams,
        settings,
      }),
    );
  }

  return instructions;
}

async function resolveAddresses(
  mint: Address,
  destination: Address,
  walletAddress: Address,
  tokenProgram: Address,
  splInterfacePdaArgs: SplInterfacePdaArgsArgs,
): Promise<ResolvedAddresses> {
  const getCtokenAta = (owner: Address) =>
    getProgramDerivedAddress({
      seeds: [
        getAddressEncoder().encode(owner),
        getAddressEncoder().encode(ctokenProgramAddress),
        getAddressEncoder().encode(mint),
      ],
      programAddress: ctokenProgramAddress,
    });

  const seeds = [
    getUtf8Encoder().encode("pool"),
    getAddressEncoder().encode(mint),
  ];
  if (splInterfacePdaArgs.restricted) {
    seeds.push(getUtf8Encoder().encode("restricted"));
  }
  if (splInterfacePdaArgs.index > 0) {
    seeds.push(getU8Encoder().encode(splInterfacePdaArgs.index));
  }

  const [
    sourceSplAta,
    [sourceCtokenAta],
    destinationSplAta,
    [destinationCTokenAta],
    [splInterfacePda],
  ] = await Promise.all([
    getAssociatedTokenAccountAddress(mint, walletAddress, tokenProgram),
    getCtokenAta(walletAddress),
    getAssociatedTokenAccountAddress(mint, destination, tokenProgram),
    getCtokenAta(destination),
    getProgramDerivedAddress({
      seeds,
      programAddress: ctokenProgramAddress,
    }),
  ]);

  return {
    sourceSplAta,
    sourceCtokenAta,
    destinationSplAta,
    destinationCTokenAta,
    splInterfacePda,
  };
}

async function fetchAccountInfos(
  addresses: ResolvedAddresses,
  cachedAccounts?: AccountCache,
) {
  const [destinationSplAtaInfo, sourceSplAtaInfo, sourceCTokenAtaInfo] =
    await Promise.all([
      fetchCachedAccountInfo(addresses.destinationSplAta, cachedAccounts),
      fetchCachedAccountInfo(addresses.sourceSplAta, cachedAccounts),
      fetchCachedAccountInfo(addresses.sourceCtokenAta, cachedAccounts),
    ]);
  return {
    destinationSplAtaInfo,
    sourceSplAtaInfo,
    sourceCTokenAtaInfo,
  };
}

function computeBalancesAndDestinations(
  accountInfos: Awaited<ReturnType<typeof fetchAccountInfos>>,
  addresses: ResolvedAddresses,
  amount: number | bigint,
  useDestinationSplAccount: boolean,
): BalancesAndDestinations {
  const destinationSplExists = !!accountInfos.destinationSplAtaInfo.value;
  const sourceSplExists = !!accountInfos.sourceSplAtaInfo.value;
  const sourceCtokenExist = !!accountInfos.sourceCTokenAtaInfo.value;

  const splBalance = sourceSplExists
    ? getTokenDecoder().decode(
        getBase64Encoder().encode(accountInfos.sourceSplAtaInfo.value!.data[0]),
      ).amount
    : BigInt(0);

  const cTokenBalance = sourceCtokenExist
    ? BigInt(
        parseTokenAmount(
          getBase64Encoder().encode(
            accountInfos.sourceCTokenAtaInfo.value!.data[0],
          ),
        )?.amount ?? 0,
      )
    : BigInt(0);

  const destinationSplTokenAccount =
    destinationSplExists || useDestinationSplAccount
      ? addresses.destinationSplAta
      : undefined;
  const destinationCtokenTokenAccount =
    destinationSplExists || useDestinationSplAccount
      ? undefined
      : addresses.destinationCTokenAta;

  const requireSplInterface =
    (sourceSplExists &&
      (splBalance + cTokenBalance < BigInt(amount) ||
        cTokenBalance > BigInt(0) ||
        !destinationSplExists)) ||
    (!sourceSplExists && destinationSplExists);

  return {
    splBalance,
    cTokenBalance,
    destinationSplTokenAccount,
    destinationCtokenTokenAccount,
    requireSplInterface,
    requireRentSponsor:
      splBalance + cTokenBalance < BigInt(amount) || !destinationSplExists,
  };
}

function buildHashesWithTree(
  compressedTokenAccount: ParsedTokenAccount | null,
  compressedSettings: HashWithTreeAndAccount | null,
): HashWithTreeAndAccount[] {
  const hashesWithTree: HashWithTreeAndAccount[] = [];
  if (compressedTokenAccount) {
    hashesWithTree.push({
      hash: compressedTokenAccount.compressedAccount.hash,
      tree: compressedTokenAccount.compressedAccount.treeInfo.tree,
      queue: compressedTokenAccount.compressedAccount.treeInfo.queue,
      data: compressedTokenAccount.compressedAccount.data,
      address: compressedTokenAccount.compressedAccount.address,
    });
  }
  if (compressedSettings) {
    hashesWithTree.push(compressedSettings);
  }
  return hashesWithTree;
}

async function resolveCompressedProofAndSettings(
  packedAccounts: PackedAccounts,
  hashesWithTree: HashWithTreeAndAccount[],
  compressedSettings: HashWithTreeAndAccount | null,
): Promise<{
  proof: ValidityProofWithContext | null;
  settingsMutArgs: SettingsMutArgs | null;
}> {
  let settingsMutArgs: SettingsMutArgs | null = null;
  let proof: ValidityProofWithContext | null = null;

  if (hashesWithTree.length === 0) {
    return { proof, settingsMutArgs };
  }

  await packedAccounts.addSystemAccounts();
  proof = await getValidityProofWithRetry(hashesWithTree, []);
  if (compressedSettings) {
    settingsMutArgs = getCompressedAccountMutArgs<CompressedSettings>(
      packedAccounts,
      proof!.treeInfos.slice(-1),
      proof!.leafIndices.slice(-1),
      proof!.rootIndices.slice(-1),
      proof!.proveByIndices.slice(-1),
      hashesWithTree.slice(-1),
      getCompressedSettingsDecoder(),
    )[0];
  }
  return { proof, settingsMutArgs };
}

function buildSourceCompressedTokenAccounts(
  compressedTokenAccount: ParsedTokenAccount | null,
  proof: ValidityProofWithContext | null,
  packedAccounts: PackedAccounts,
): OptionOrNullable<CompressedTokenArgsArgs> {
  if (!proof || !compressedTokenAccount) {
    return none();
  }
  return some({
    amount: compressedTokenAccount.parsed.amount.toNumber(),
    merkleContext: {
      leafIndex: compressedTokenAccount.compressedAccount.leafIndex,
      merkleTreePubkeyIndex: packedAccounts.insertOrGet(
        compressedTokenAccount.compressedAccount.treeInfo.tree.toString(),
      ),
      queuePubkeyIndex: packedAccounts.insertOrGet(
        compressedTokenAccount.compressedAccount.treeInfo.queue.toString(),
      ),
      proveByIndex: compressedTokenAccount.compressedAccount.proveByIndex,
    },
    rootIndex: proof.rootIndices[0],
    version: getVersionFromDiscriminator(
      compressedTokenAccount.compressedAccount.data?.discriminator,
    ),
    tlv: compressedTokenAccount.parsed.tlv
      ? some(
          getArrayDecoder(getExtensionStructDecoder()).decode(
            compressedTokenAccount.parsed.tlv,
          ),
        )
      : none(),
    state: compressedTokenAccount.parsed.state,
  });
}

function buildCommonParams({
  amount,
  transactionSyncSigners,
  walletAddress,
  destination,
  addresses,
  balances,
  mint,
  tokenProgram,
  remainingAccounts,
  payer,
  sourceCompressedTokenAccount,
  compressedProofArgs,
  splInterfacePdaArgs,
  delegate,
}: {
  amount: number | bigint;
  transactionSyncSigners: TransactionSyncSignersArgs[];
  walletAddress: Address;
  destination: Address;
  addresses: ResolvedAddresses;
  balances: BalancesAndDestinations;
  mint: Address;
  tokenProgram: Address;
  remainingAccounts: ReturnType<
    PackedAccounts["toAccountMetas"]
  >["remainingAccounts"];
  payer: TransactionSigner;
  sourceCompressedTokenAccount: OptionOrNullable<CompressedTokenArgsArgs>;
  compressedProofArgs: ReturnType<typeof convertToCompressedProofArgs>;
  splInterfacePdaArgs: SplInterfacePdaArgsArgs;
  delegate?: Address;
}) {
  return {
    amount,
    signers: transactionSyncSigners,
    source: walletAddress,
    destination,
    sourceCtokenTokenAccount: addresses.sourceCtokenAta,
    sourceSplTokenAccount: addresses.sourceSplAta,
    destinationCtokenTokenAccount: balances.destinationCtokenTokenAccount,
    destinationSplTokenAccount: balances.destinationSplTokenAccount,
    mint,
    tokenProgram,
    remainingAccounts,
    payer,
    sourceCompressedTokenAccount,
    compressedProofArgs,
    compressibleConfig,
    splInterfacePda: balances.requireSplInterface
      ? addresses.splInterfacePda
      : undefined,
    rentSponsor: balances.requireRentSponsor ? rentSponsor : undefined,
    splInterfacePdaArgs: (balances.requireSplInterface
      ? some(splInterfacePdaArgs)
      : none()) as OptionOrNullable<SplInterfacePdaArgsArgs>,
    delegate,
  };
}

async function checkIfSplInterfaceNeedsToBeInitialized(
  requireSplInterface: boolean,
  splInterfacePda: Address,
  cachedAccounts?: AccountCache,
): Promise<boolean> {
  if (!requireSplInterface) return false;
  const { value } = await fetchCachedAccountInfo(
    splInterfacePda,
    cachedAccounts,
  );
  return !value;
}

async function getCompressedTokenAccount(
  walletAddress: string,
  mint: string,
  splBalance: bigint,
  cTokenBalance: bigint,
  total: bigint,
) {
  const transferAmount = total - splBalance - cTokenBalance;
  if (transferAmount <= 0) {
    return null;
  }
  const compressedResult =
    await getLightProtocolRpc().getCompressedTokenAccountsByOwner(
      new PublicKey(walletAddress),
      { mint: new PublicKey(mint) },
    );

  const accounts = compressedResult.items.filter(
    (x) =>
      !!x.compressedAccount.data?.data.length &&
      x.compressedAccount.owner.toString() ===
        ctokenProgramAddress.toString() &&
      !x.parsed.amount.isZero() &&
      !!x.parsed.tlv &&
      getArrayDecoder(getExtensionStructDecoder())
        .decode(x.parsed.tlv)
        .some((e) => e.__kind === "CompressedOnly" && e.fields[0].isAta),
  );

  if (accounts.length === 0) {
    return null;
  }

  return accounts[0];
}

async function getCompressedSettings(
  compressed: boolean,
  settings: Address,
  settingsAddressTreeIndex?: number,
  cachedAccounts?: AccountCache,
): Promise<HashWithTreeAndAccount | null> {
  if (!compressed) return null;
  const { address: settingsAddress } = await getCompressedSettingsAddress(
    settings,
    settingsAddressTreeIndex,
  );
  const hashes = await getCompressedAccountHashes(
    [{ address: settingsAddress, type: "Settings" }],
    cachedAccounts,
  );
  return (hashes[0] ?? null) as HashWithTreeAndAccount | null;
}

function parseTokenAmount(data: ReadonlyUint8Array): {
  amount: number | bigint;
} | null {
  if (!data || data.length === 0) return null;
  try {
    const amount = getU64Decoder().decode(data.slice(64, 72));
    return {
      amount,
    };
  } catch (error) {
    console.error("Token data parsing error:", error);
    return null;
  }
}
