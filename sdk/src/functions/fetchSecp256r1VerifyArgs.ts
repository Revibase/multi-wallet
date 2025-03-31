import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { signTransaction } from "../passkeys";
import { Secp256r1Key } from "../types";
import { base64URLStringToBuffer, getDomainConfig } from "../utils";

export async function fetchSecp256r1VerifyArgs(
  type: "create" | "execute" | "vote" | "close",
  pubkey: PublicKey | Secp256r1Key,
  connection?: Connection,
  transactionBufferAddress?: PublicKey,
  transactionMessageBytes?: Buffer
) {
  if (pubkey instanceof Secp256r1Key) {
    if (!connection || !transactionBufferAddress || !transactionMessageBytes) {
      throw new Error(
        "Connection, Transaction Key and Message Bytes is required."
      );
    }
    const { slotHash, slotNumber, response } = await signTransaction(
      connection,
      {
        transactionBufferAddress,
        transactionMessageBytes,
        type,
      },
      pubkey.toString()
    );
    if (!slotHash || !slotNumber) {
      throw new Error("Unable to fetch slot hash or slot number.");
    }

    const authData = new Uint8Array(
      base64URLStringToBuffer(response.authenticatorData)
    );
    const domainConfig = getDomainConfig(authData.subarray(0, 32));
    const clientDataJson = new Uint8Array(
      base64URLStringToBuffer(response.clientDataJSON)
    );

    const verifyArgs = {
      signature: Array.from(
        new Uint8Array(base64URLStringToBuffer(response.signature))
      ),
      pubkey: Array.from(pubkey.toBuffer()),
      authData: Buffer.from(authData),
      clientDataJson: Buffer.from(clientDataJson),
      slotNumber: new BN(slotNumber),
      slotHash: Array.from(new Uint8Array(base64URLStringToBuffer(slotHash))),
    };

    return { verifyArgs, domainConfig };
  }
  return { verifyArgs: null, domainConfig: null };
}
