import {
  address,
  getBase58Encoder,
  getBase64Decoder,
  getTransactionEncoder,
  type SignatureBytes,
  type TransactionSigner,
} from "gill";
import { REVIBASE_AUTH_URL } from "./consts";

/**
 * Opens a popup window for WebAuthn or authentication workflows.
 *
 * This helper creates a centered, resizable popup on desktop, and a full-screen view on mobile.
 * It defaults to the `/loading` route of your configured authentication origin.
 *
 * @param url - The URL to load in the popup.
 * @returns A reference to the newly created popup window, or `null` if blocked by the browser.
 *
 * @throws {Error} If called outside a browser environment.
 *
 */

export function createPopUp(url = `${REVIBASE_AUTH_URL}/loading`) {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }

  const screenWidth = window.innerWidth || screen.availWidth;
  const screenHeight = window.innerHeight || screen.availHeight;
  const isMobile = screenWidth <= 768;

  let width: number;
  let height: number;
  let top: number;
  let left: number;

  if (isMobile) {
    width = screenWidth;
    height = screenHeight;
    top = 0;
    left = 0;
  } else {
    const currentScreenLeft = window.screenLeft ?? window.screenX;
    const currentScreenTop = window.screenTop ?? window.screenY;
    const screenWidth =
      window.innerWidth ?? document.documentElement.clientWidth ?? screen.width;
    const screenHeight =
      window.innerHeight ??
      document.documentElement.clientHeight ??
      screen.height;
    width = 500;
    height = 600;
    left = currentScreenLeft + (screenWidth - width) / 2;
    top = currentScreenTop + (screenHeight - height) / 2;
  }

  const features = [
    `width=${width}`,
    `height=${height}`,
    `top=${top}`,
    `left=${left}`,
    `toolbar=no`,
    `location=no`,
    `status=no`,
    `menubar=no`,
    `scrollbars=yes`,
    `resizable=yes`,
  ].join(",");

  const passKeyPopup = window.open(url, "_blank", features);

  if (passKeyPopup) {
    passKeyPopup.focus();
  }

  return passKeyPopup;
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
