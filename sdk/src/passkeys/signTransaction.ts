import {
  Connection,
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
} from "@solana/web3.js";
import { bufferToBase64URLString } from "../utils";
import { IDP_URL } from "./consts";
import { openAuthUrl } from "./utils";

export async function signTransaction(
  connection: Connection,
  payload: {
    transactionBufferAddress: PublicKey;
    transactionMessageBytes: Buffer;
    type: "create" | "execute" | "vote" | "close";
  },
  publicKey?: string
) {
  if (!window) {
    throw new Error("Function can only be called in a browser environment");
  }
  const latestSlotHashAccountInfo = await connection.getAccountInfo(
    SYSVAR_SLOT_HASHES_PUBKEY,
    "processed"
  );
  if (!latestSlotHashAccountInfo) {
    throw new Error("Failed to fetch latest slot hash");
  }

  const slotNumber = latestSlotHashAccountInfo.data
    .readBigInt64LE(8)
    .toString();

  const slotHash = bufferToBase64URLString(
    latestSlotHashAccountInfo.data.subarray(16, 48)
  );

  const authUrl = `${IDP_URL}/?transaction=${encodeURIComponent(
    JSON.stringify({
      type: payload.type,
      transactionBufferAddress: payload.transactionBufferAddress.toString(),
      transactionMessageBytes: bufferToBase64URLString(
        payload.transactionMessageBytes
      ),
      slotNumber,
      slotHash,
    })
  )}&redirectUrl=${encodeURIComponent(window.origin)}${
    publicKey ? `&publicKey=${encodeURIComponent(publicKey)}` : ""
  }`;
  return await openAuthUrl(authUrl);
}
