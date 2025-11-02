import { sha256 } from "@noble/hashes/sha256";
import {
  type AccountMeta,
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase58Encoder,
  getBase64Decoder,
  getBlockhashDecoder,
  getTransactionEncoder,
  type Instruction,
  type OptionOrNullable,
  pipe,
  prependTransactionMessageInstructions,
  type Rpc,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type SignatureBytes,
  signTransactionMessageWithSigners,
  type SolanaRpcApi,
  some,
  type TransactionSigner,
} from "gill";
import {
  getSetComputeUnitLimitInstruction,
  getTransferSolInstruction,
} from "gill/programs";
import type { Secp256r1VerifyArgs } from "../../generated";
import { SignedSecp256r1Key, type TransactionDetails } from "../../types";
import { getSolanaRpc } from "../initialize";

export async function createEncodedBundle(
  bundle: (TransactionDetails & { unitsConsumed?: number })[],
  isSimulate = false
) {
  const latestBlockHash = isSimulate
    ? {
        blockhash: getBlockhashDecoder().decode(
          crypto.getRandomValues(new Uint8Array(32))
        ),
        lastValidBlockHeight: BigInt(Number.MAX_SAFE_INTEGER),
      }
    : (await getSolanaRpc().getLatestBlockhash().send()).value;
  return await Promise.all(
    bundle.map(async (x) => {
      const tx = await pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => appendTransactionMessageInstructions(x.instructions, tx),
        (tx) => setTransactionMessageFeePayerSigner(x.payer, tx),
        (tx) =>
          setTransactionMessageLifetimeUsingBlockhash(latestBlockHash, tx),
        (tx) =>
          x.addressesByLookupTableAddress
            ? compressTransactionMessageUsingAddressLookupTables(
                tx,
                x.addressesByLookupTableAddress
              )
            : tx,
        async (tx) => {
          const computeUnits =
            Math.ceil((x.unitsConsumed ?? 0) * 1.1) || 800000;
          return computeUnits > 200000
            ? prependTransactionMessageInstructions(
                [
                  getSetComputeUnitLimitInstruction({
                    units: computeUnits,
                  }),
                ],
                tx
              )
            : tx;
        },
        async (tx) =>
          isSimulate
            ? compileTransaction(await tx)
            : await signTransactionMessageWithSigners(await tx)
      );
      return tx;
    })
  );
}
export async function getMedianPriorityFees(
  connection: Rpc<SolanaRpcApi>,
  accounts: AccountMeta[]
) {
  const recentFees = await connection
    .getRecentPrioritizationFees(
      accounts
        .filter(
          (x) =>
            x.role === AccountRole.WRITABLE ||
            x.role === AccountRole.WRITABLE_SIGNER
        )
        .map((x) => x.address)
    )
    .send();
  const fees = recentFees.map((f) => Number(f.prioritizationFee));
  fees.sort((a, b) => a - b);
  const mid = Math.floor(fees.length / 2);

  if (fees.length % 2 === 0) {
    return Math.round((fees[mid - 1] + fees[mid]) / 2);
  } else {
    return fees[mid];
  }
}

export async function simulateBundle(bundle: string[], connectionUrl: string) {
  if (bundle.length === 0) {
    throw new Error("Bundle is empty.");
  }

  for (let i = 0; i < bundle.length; i++) {
    if (bundle[i].length > 1644) {
      throw new Error(
        `Transaction ${i} exceeds maximum length, ${bundle[i].length}. Retry again.`
      );
    }
    console.log(`Transaction ${i} length: ${bundle[i].length}`);
  }

  const response = await fetch(connectionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "2",
      method: "simulateBundle",
      params: [
        {
          encodedTransactions: bundle,
        },
        {
          skipSigVerify: true,
          replaceRecentBlockhash: true,
          preExecutionAccountsConfigs: bundle.map(() => ({
            encoding: "base64",
            addresses: [],
          })),
          postExecutionAccountsConfigs: bundle.map(() => ({
            encoding: "base64",
            addresses: [],
          })),
        },
      ],
    }),
  });

  if (!response.ok) {
    console.error(await response.json());
    throw new Error("Failed to simulate bundle");
  }
  const { result, error } = await response.json();

  if (!result || error) {
    console.error(error ?? result);
    throw new Error(
      `Unable to simulate bundle: ${JSON.stringify(error ?? result)}`
    );
  }
  if (typeof result.value.summary !== "string" && result.value.summary.failed) {
    const { TransactionFailure } = result.value.summary.failed.error;
    const [, programError] = TransactionFailure;
    console.error(error ?? result);
    throw new Error(`Simulation failed: ${programError}`);
  }

  return result.value.transactionResults.map((x: any) => x.unitsConsumed);
}

export function extractSecp256r1VerificationArgs(
  signer?: SignedSecp256r1Key | TransactionSigner,
  index = 0
) {
  const secp256r1PublicKey =
    signer instanceof SignedSecp256r1Key ? signer : undefined;
  const verifyArgs: OptionOrNullable<Secp256r1VerifyArgs> =
    secp256r1PublicKey?.verifyArgs && index !== -1
      ? some({
          signedMessageIndex: index,
          truncatedClientDataJson:
            secp256r1PublicKey.verifyArgs.truncatedClientDataJson,
          slotNumber: secp256r1PublicKey.verifyArgs.slotNumber,
          originIndex: secp256r1PublicKey.originIndex,
          crossOrigin: secp256r1PublicKey.crossOrigin,
        })
      : null;

  const domainConfig = secp256r1PublicKey?.domainConfig
    ? secp256r1PublicKey.domainConfig
    : undefined;
  const signature = secp256r1PublicKey?.verifyArgs
    ? secp256r1PublicKey.signature
    : undefined;
  const message =
    secp256r1PublicKey?.authData &&
    secp256r1PublicKey.verifyArgs?.clientDataJson
      ? new Uint8Array([
          ...secp256r1PublicKey.authData,
          ...sha256(secp256r1PublicKey.verifyArgs.clientDataJson),
        ])
      : undefined;
  const publicKey = secp256r1PublicKey?.toBuffer();

  return {
    domainConfig,
    verifyArgs,
    signature,
    message,
    publicKey,
  };
}
export function getDeduplicatedSigners(
  signers: (SignedSecp256r1Key | TransactionSigner)[]
) {
  function getPubkeyString(pubkey: TransactionSigner | SignedSecp256r1Key) {
    if (pubkey instanceof SignedSecp256r1Key) {
      return pubkey.toString();
    } else {
      return pubkey.address.toString();
    }
  }
  const hashSet = new Set();
  const dedupSigners: (SignedSecp256r1Key | TransactionSigner)[] = [];
  for (const signer of signers) {
    if (!hashSet.has(getPubkeyString(signer))) {
      dedupSigners.push(signer);
      hashSet.add(getPubkeyString(signer));
    }
  }

  // due to current tx size limit (can be removed once tx size limit increases)
  if (dedupSigners.filter((x) => x instanceof SignedSecp256r1Key).length > 1) {
    throw new Error(
      "More than 1 Secp256r1 signers in an instruction is not supported."
    );
  }
  return dedupSigners;
}

export function addJitoTip({
  payer,
  tipAmount,
}: {
  payer: TransactionSigner;
  tipAmount: number;
}): Instruction {
  const JITO_TIP_ACCOUNTS = [
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  ];
  const tipAccount =
    JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
  return getTransferSolInstruction({
    source: payer,
    destination: address(tipAccount),
    amount: tipAmount,
  });
}
export async function getRandomPayer(
  payerEndpoint: string
): Promise<TransactionSigner> {
  const response = await fetch(`${payerEndpoint}/getRandomPayer`);
  const { randomPayer } = (await response.json()) as { randomPayer: string };

  return {
    address: address(randomPayer),
    async signTransactions(transactions) {
      const payload = {
        publicKey: randomPayer,
        transactions: transactions.map((tx) =>
          getBase64Decoder().decode(getTransactionEncoder().encode(tx))
        ),
      };

      const response = await fetch(`${payerEndpoint}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as
        | { signatures: string[] }
        | { error: string };

      if ("error" in data) {
        throw new Error(data.error);
      }

      return data.signatures.map((sig) => ({
        [address(randomPayer)]: getBase58Encoder().encode(
          sig
        ) as SignatureBytes,
      }));
    },
  };
}
