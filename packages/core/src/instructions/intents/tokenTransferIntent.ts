import {
  TreeType,
  type AddressWithTree,
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
  getExtensionStructDecoder,
  getTokenTransferIntentInstruction,
  type CompressedProofArgs,
  type CompressedTokenArgsArgs,
  type SplInterfacePdaArgsArgs,
} from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import {
  getLightProtocolRpc,
  getSolanaRpc,
  getWalletAddressFromSettings,
} from "../../utils";
import { retryWithBackoff } from "../../utils/retry";
import {
  buildSignerAccounts,
  getDeduplicatedSigners,
} from "../../utils/transaction/internal";
import { PackedAccounts } from "../../utils/transaction/packedAccounts";
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
  destination: Address;
  mint: Address;
  amount: number | bigint;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  tokenProgram: Address;
  payer: TransactionSigner;
  splInterfacePdaArgs?: SplInterfacePdaArgsArgs;
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
  destination,
  mint,
  signers,
  amount,
  payer,
  tokenProgram,
  splInterfacePdaArgs = { index: 0, restricted: false },
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

  const accountInfos = await fetchAccountInfos(addresses);

  const balances = computeBalancesAndDestinations(
    accountInfos,
    addresses,
    amount,
  );

  const [compressedTokenAccounts, splInterfaceNeedsInitialization] =
    await Promise.all([
      getCompressedTokenAccounts(
        walletAddress,
        mint,
        balances.splBalance,
        balances.cTokenBalance,
        BigInt(amount),
      ),
      checkIfSplInterfaceNeedsToBeInitialized(
        balances.requireSplInterface,
        addresses.splInterfacePda,
      ),
    ]);

  const compressedTotalBalance = BigInt(
    compressedTokenAccounts.reduce(
      (sum, x) => sum + (x.parsed.amount.toNumber() ?? 0),
      0,
    ),
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

  const hashesWithTree = buildHashesWithTree(compressedTokenAccounts);
  const { proof } = await resolveCompressedProofAndSettings(
    packedAccounts,
    hashesWithTree,
  );

  const sourceCompressedTokenAccounts = buildSourceCompressedTokenAccounts(
    compressedTokenAccounts,
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

  instructions.push(
    getTokenTransferIntentInstruction({
      settings,
      payer,
      source: walletAddress,
      sourceSplTokenAccount: addresses.sourceSplAta,
      sourceCtokenTokenAccount: addresses.sourceCtokenAta,
      destination,
      destinationSplTokenAccount: balances.destinationSplTokenAccount,
      destinationCtokenTokenAccount: balances.destinationCtokenTokenAccount,
      tokenProgram,
      mint,
      splInterfacePda: balances.requireSplInterface
        ? addresses.splInterfacePda
        : undefined,
      compressibleConfig,
      rentSponsor: balances.requireRentSponsor ? rentSponsor : undefined,
      amount,
      signers: transactionSyncSigners,
      sourceCompressedTokenAccounts,
      compressedProofArgs,
      splInterfacePdaArgs: balances.requireSplInterface
        ? some(splInterfacePdaArgs)
        : none(),
      remainingAccounts,
    }),
  );

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

async function fetchAccountInfos(addresses: ResolvedAddresses) {
  const [destinationSplAtaInfo, sourceSplAtaInfo, sourceCTokenAtaInfo] =
    await Promise.all([
      getSolanaRpc()
        .getAccountInfo(addresses.destinationSplAta, { encoding: "base64" })
        .send(),
      getSolanaRpc()
        .getAccountInfo(addresses.sourceSplAta, { encoding: "base64" })
        .send(),
      getSolanaRpc()
        .getAccountInfo(addresses.sourceCtokenAta, { encoding: "base64" })
        .send(),
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

  const destinationSplTokenAccount = destinationSplExists
    ? addresses.destinationSplAta
    : undefined;
  const destinationCtokenTokenAccount = destinationSplExists
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
  compressedTokenAccounts: ParsedTokenAccount[],
): HashWithTreeAndAccount[] {
  const hashesWithTree: HashWithTreeAndAccount[] = [];
  compressedTokenAccounts.forEach((x) =>
    hashesWithTree.push({
      hash: x.compressedAccount.hash,
      tree: x.compressedAccount.treeInfo.tree,
      queue: x.compressedAccount.treeInfo.queue,
      data: x.compressedAccount.data,
      address: x.compressedAccount.address,
    }),
  );

  return hashesWithTree;
}

async function resolveCompressedProofAndSettings(
  packedAccounts: PackedAccounts,
  hashesWithTree: HashWithTreeAndAccount[],
): Promise<{
  proof: ValidityProofWithContext | null;
}> {
  let proof: ValidityProofWithContext | null = null;

  if (hashesWithTree.length === 0) {
    return { proof };
  }

  await packedAccounts.addSystemAccounts();
  proof = await getValidityProofWithRetry(hashesWithTree, []);

  return { proof };
}

function buildSourceCompressedTokenAccounts(
  compressedTokenAccounts: ParsedTokenAccount[],
  proof: ValidityProofWithContext | null,
  packedAccounts: PackedAccounts,
): CompressedTokenArgsArgs[] {
  if (!proof || !compressedTokenAccounts.length) {
    return [];
  }
  return compressedTokenAccounts.map((x) => ({
    amount: x.parsed.amount.toNumber(),
    merkleContext: {
      leafIndex: x.compressedAccount.leafIndex,
      merkleTreePubkeyIndex: packedAccounts.insertOrGet(
        x.compressedAccount.treeInfo.tree.toString(),
      ),
      queuePubkeyIndex: packedAccounts.insertOrGet(
        x.compressedAccount.treeInfo.queue.toString(),
      ),
      proveByIndex: x.compressedAccount.proveByIndex,
    },
    rootIndex: proof.rootIndices[0],
    version: getVersionFromDiscriminator(
      x.compressedAccount.data?.discriminator,
    ),
    tlv: x.parsed.tlv
      ? some(getArrayDecoder(getExtensionStructDecoder()).decode(x.parsed.tlv))
      : none(),
    state: x.parsed.state,
  }));
}

async function checkIfSplInterfaceNeedsToBeInitialized(
  requireSplInterface: boolean,
  splInterfacePda: Address,
): Promise<boolean> {
  if (!requireSplInterface) return false;
  const { value } = await getSolanaRpc()
    .getAccountInfo(splInterfacePda, { encoding: "base64" })
    .send();
  return !value;
}

async function getCompressedTokenAccounts(
  walletAddress: string,
  mint: string,
  splBalance: bigint,
  cTokenBalance: bigint,
  total: bigint,
) {
  const transferAmount = total - splBalance - cTokenBalance;
  if (transferAmount <= 0) {
    return [];
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
      !x.parsed.amount.isZero(),
  );

  if (accounts.length === 0) {
    return [];
  }
  const selectedAccounts = selectMinCompressedTokenAccountsForDecompression(
    accounts,
    Number(transferAmount),
    4,
    { treeType: TreeType.StateV2 },
  );

  return selectedAccounts;
}

function selectMinCompressedTokenAccountsForDecompression(
  accounts: ParsedTokenAccount[],
  transferAmount: number,
  maxInputs: number = 4,
  options?: { treeType: TreeType },
) {
  const filteredAccounts = accounts.filter(
    (x) => x.compressedAccount.treeInfo.treeType === options?.treeType,
  );

  if (filteredAccounts.length === 0) {
    throw new Error("No accounts found");
  }

  let accumulatedAmount = 0;
  let accumulatedLamports = 0;
  let maxPossibleAmount = 0;

  const selectedAccounts: ParsedTokenAccount[] = [];

  filteredAccounts.sort((a, b) => b.parsed.amount.cmp(a.parsed.amount));

  for (const account of filteredAccounts) {
    if (selectedAccounts.length >= maxInputs) break;
    if (accumulatedAmount >= transferAmount) break;

    if (
      !account.parsed.amount.isZero() ||
      !account.compressedAccount.lamports.isZero()
    ) {
      accumulatedAmount = accumulatedAmount + account.parsed.amount.toNumber();
      accumulatedLamports =
        accumulatedLamports + account.compressedAccount.lamports.toNumber();

      selectedAccounts.push(account);
    }
  }

  // Max, considering maxInputs
  maxPossibleAmount = filteredAccounts
    .slice(0, maxInputs)
    .reduce((total, account) => total + account.parsed.amount.toNumber(), 0);

  if (selectedAccounts.length === 0) {
    throw new Error("No accounts found.");
  }

  if (accumulatedAmount < transferAmount) {
    const totalBalance = filteredAccounts.reduce(
      (acc, account) => acc + account.parsed.amount.toNumber(),
      0,
    );
    if (selectedAccounts.length >= maxInputs) {
      throw new Error(
        `Account limit exceeded: max ${maxPossibleAmount.toString()} (${maxInputs} accounts) per transaction. Total balance: ${totalBalance.toString()} (${filteredAccounts.length} accounts). Consider multiple transfers to spend full balance.`,
      );
    } else {
      throw new Error(
        `Insufficient balance for transfer. Required: ${transferAmount.toString()}, available: ${totalBalance.toString()}.`,
      );
    }
  }

  if (selectedAccounts.length === 0) {
    throw new Error("No accounts found.");
  }

  return selectedAccounts;
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
enum TokenDataVersion {
  V1 = 1,
  V2 = 2,
  ShaFlat = 3,
}

export function getVersionFromDiscriminator(
  discriminator: number[] | undefined,
): number {
  if (!discriminator || discriminator.length < 8) {
    return TokenDataVersion.ShaFlat;
  }
  if (discriminator[0] === 2) {
    return TokenDataVersion.V1;
  }
  const versionByte = discriminator[7];
  if (versionByte === 3) {
    return TokenDataVersion.V2;
  }
  if (versionByte === 4) {
    return TokenDataVersion.ShaFlat;
  }
  return TokenDataVersion.ShaFlat;
}

function convertToCompressedProofArgs(
  validityProof: ValidityProofWithContext | null,
  offset: number,
) {
  const proof: OptionOrNullable<CompressedProofArgs> =
    validityProof?.compressedProof
      ? some({
          a: new Uint8Array(validityProof.compressedProof.a),
          b: new Uint8Array(validityProof.compressedProof.b),
          c: new Uint8Array(validityProof.compressedProof.c),
        })
      : null;
  return {
    proof,
    lightCpiAccountsStartIndex: offset,
  };
}

async function getValidityProofWithRetry(
  hashes?: HashWithTree[] | undefined,
  newAddresses?: AddressWithTree[],
): Promise<ValidityProofWithContext> {
  return retryWithBackoff(() =>
    getLightProtocolRpc().getValidityProofV0(hashes, newAddresses),
  );
}
