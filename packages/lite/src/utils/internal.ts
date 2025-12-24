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
