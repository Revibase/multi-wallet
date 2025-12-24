import {
  fetchUserAccountData,
  getJitoTipsConfig,
  Secp256r1Key,
  type CompleteMessageRequest,
  type CompleteTransactionRequest,
  type SettingsIndexWithAddressArgs,
  type StartMessageRequest,
  type StartTransactionRequest,
} from "@revibase/core";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createNoopSigner,
  createTransactionMessage,
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  getBlockhashDecoder,
  pipe,
  prependTransactionMessageInstructions,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type AddressesByLookupTableAddress,
  type Instruction,
} from "gill";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "gill/programs";
import { REVIBASE_LOOKUP_TABLE_ADDRESS } from "./consts";
import { createPopUp } from "./helper";

const DEFAULT_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const HEARTBEAT_INTERVAL = 500; // ms

type PopupMessage =
  | { type: "popup-init"; payload: any; signature: string }
  | { type: "popup-ready" }
  | { type: "popup-complete"; payload: any }
  | { type: "popup-error"; error: string }
  | { type: "popup-closed" }
  | { type: "popup-connect" };

export async function openAuthUrl({
  authUrl,
  payload,
  signature,
  popUp = null,
}: {
  authUrl: string;
  payload: StartMessageRequest | StartTransactionRequest;
  signature: string;
  popUp?: Window | null;
}): Promise<any> {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }

  return new Promise((resolve, reject) => {
    const origin = new URL(authUrl).origin;
    let settled = false;
    let port: MessagePort | null = null;

    // Cleanup function
    const cleanup = () => {
      if (settled) return;
      settled = true;

      clearTimeout(timeout);
      clearInterval(heartbeatInterval);
      port?.close();

      try {
        popUp && !popUp.closed && popUp.close();
      } catch {}
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Authentication timed out"));
    }, DEFAULT_TIMEOUT);

    const heartbeatInterval = setInterval(() => {
      if (popUp?.closed) {
        cleanup();
        reject(new Error("User closed the authentication window"));
      }
    }, HEARTBEAT_INTERVAL);

    if (!popUp) {
      popUp = createPopUp(authUrl);
    } else {
      try {
        if (popUp.location.href !== authUrl) popUp.location.replace(authUrl);
      } catch {
        popUp.location.replace(authUrl);
      }
    }

    if (!popUp) {
      cleanup();
      reject(new Error("Popup blocked. Please enable popups."));
      return;
    }

    // ✅ Wait for the popup to send its port first
    const onConnect = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      if (event.data?.type !== "popup-connect") return;
      if (!event.ports?.[0]) return;

      port = event.ports[0];
      port.start();

      port.postMessage({ type: "popup-init", payload, signature });

      port.onmessage = (event: MessageEvent<PopupMessage>) => {
        const data = event.data;

        switch (data.type) {
          case "popup-complete":
            cleanup();
            resolve(data.payload);
            break;

          case "popup-error":
            cleanup();
            reject(new Error(data.error));
            break;

          case "popup-closed":
            cleanup();
            reject(new Error("User closed the authentication window"));
            break;
        }
      };

      window.removeEventListener("message", onConnect);
    };

    window.addEventListener("message", onConnect);
  });
}

export function createSignInMessageText(input: {
  domain: string;
  nonce: string;
}): string {
  let message = `${input.domain} wants you to sign in with your account.`;

  const fields: string[] = [];

  if (input.nonce) {
    fields.push(`Nonce: ${input.nonce}`);
  }
  if (fields.length) {
    message += `\n\n${fields.join("\n")}`;
  }

  return message;
}

export async function getSettingsIndexWithAddress(
  request: CompleteMessageRequest | CompleteTransactionRequest,
  cachedAccounts?: Map<string, any>
) {
  let settingsIndexWithAddress: SettingsIndexWithAddressArgs;
  if (!request.data.payload.additionalInfo.settingsIndexWithAddress) {
    const userAccountData = await fetchUserAccountData(
      new Secp256r1Key(request.data.payload.signer),
      request.data.payload.userAddressTreeIndex,
      cachedAccounts
    );
    if (userAccountData.delegatedTo.__option === "None") {
      throw Error("User has no delegated wallet");
    }
    settingsIndexWithAddress = userAccountData.delegatedTo.value;
  } else {
    settingsIndexWithAddress =
      request.data.payload.additionalInfo.settingsIndexWithAddress;
  }
  return settingsIndexWithAddress;
}

export function estimateTransactionSizeExceedLimit(
  instructions: Instruction[],
  addressesByLookupTableAddress?: AddressesByLookupTableAddress
) {
  const tx = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
    (tx) =>
      setTransactionMessageFeePayerSigner(
        createNoopSigner(
          getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)))
        ),
        tx
      ),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: getBlockhashDecoder().decode(
            crypto.getRandomValues(new Uint8Array(32))
          ),
          lastValidBlockHeight: BigInt(Number.MAX_SAFE_INTEGER),
        },
        tx
      ),
    (tx) =>
      addressesByLookupTableAddress
        ? compressTransactionMessageUsingAddressLookupTables(
            tx,
            addressesByLookupTableAddress
          )
        : tx,
    (tx) =>
      prependTransactionMessageInstructions(
        [
          getSetComputeUnitLimitInstruction({
            units: 800_000,
          }),
          getSetComputeUnitPriceInstruction({
            microLamports: 1000,
          }),
        ],
        tx
      ),

    (tx) => compileTransaction(tx)
  );
  const txSize = getBase64EncodedWireTransaction(tx).length;
  console.log("Estimated Tx Size: ", txSize);
  return txSize > 1644 * 0.7;
}

export async function estimateJitoTips(jitoTipsConfig = getJitoTipsConfig()) {
  const { getJitoTipsUrl: estimateJitoTipsEndpoint, priority } = jitoTipsConfig;
  const response = await fetch(estimateJitoTipsEndpoint);
  const result = await response.json();
  const tipAmount = Math.round(result[0][priority] * 10 ** 9) as number;
  return tipAmount;
}

export function getAddressByLookUpTable(): AddressesByLookupTableAddress {
  return {
    [address(REVIBASE_LOOKUP_TABLE_ADDRESS)]: [
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "11111111111111111111111111111111",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
      "Sysvar1nstructions1111111111111111111111111",
      "auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg",
      "SysvarS1otHashes111111111111111111111111111",
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      "3C6AdJiD9qxMqZTmB53b5HC5Yfq2Bb57XAzYDzu4YDcj",
      "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY",
      "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV",
      "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK",
      "GXtd2izAiMJPwMEjfgTRH3d7k9mjn4Jq3JrWFv9gySYy",
      "SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7",
      "35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh",
      "HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA",
      "compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq",
      "smt1NamzXdq4AMqS2fS2F1i5KTYPZRhoHgWx38d8WsT",
      "nfq1NvQDJ2GEgnS8zt9prAe8rjjpAW1zFkrvZoBR148",
      "amt1Ayt45jfbdw5YSo7iz6WZxUmnZsQTYXy82hVwyC2",
      "aq1S9z4reTSQAdgWHGD2zDaS39sjGrAxbR31vxJ2F4F",
      "cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m",
      "6MZszp7ihPjUeoi8RJs9NNC4jBxi7beiqvXHJhxd7fe",
      "smt2rJAFdyJJupwMKAqTNAJwvjhmiZ4JYGZmbVRw1Ho",
      "nfq2hgS7NYemXsFaFUCe3EMXSDSfnZnAe27jC6aPP1X",
      "smt3AFtReRGVcrP11D6bSLEaKdUmrGfaTNowMVccJeu",
      "nfq3de4qt9d3wHxXWy1wcge3EXhid25mCr12bNWFdtV",
      "smt4vjXvdjDFzvRMUxwTWnSy4c7cKkMaHuPrGsdDH7V",
      "nfq4Ncp1vk3mFnCQ9cvwidp9k2L6fxEyCo2nerYD25A",
      "smt5uPaQT9n6b1qAkgyonmzRxtuazA53Rddwntqistc",
      "nfq5b5xEguPtdD6uPetZduyrB5EUqad7gcUE46rALau",
      "smt6ukQDSPPYHSshQovmiRUjG9jGFq2hW9vgrDFk5Yz",
      "nfq6uzaNZ5n3EWF4t64M93AWzLGt5dXTikEA9fFRktv",
      "smt7onMFkvi3RbyhQCMajudYQkB1afAFt9CDXBQTLz6",
      "nfq7yytdKkkLabu1KpvLsa5VPkvCT4jPWus5Yi74HTH",
      "smt8TYxNy8SuhAdKJ8CeLtDkr2w6dgDmdz5ruiDw9Y9",
      "nfq8vExDykci3VUSpj9R1totVst87hJfFWevNK4hiFb",
      "smt9ReAYRF5eFjTd5gBJMn5aKwNRcmp3ub2CQr2vW7j",
      "nfq9KFpNQL45ppP6ZG7zBpUeN18LZrNGkKyvV1kjTX2",
      "smtAvYA5UbTRyKAkAj5kHs1CmrA42t6WkVLi4c6mA1f",
      "nfqAroCRkcZBgsAJDNkptKpsSWyM6cgB9XpWNNiCEC4",
      "2cLqZJrYMuCzKdSZBoWxZ3tXoeCMmMyDiuy6UBaKnbmK",
      "5tgzUZaVtfnnSEBgmBDtJj6PdgYCnA1uaEGEUi3y5Njg",
    ].map(address),
  };
}
