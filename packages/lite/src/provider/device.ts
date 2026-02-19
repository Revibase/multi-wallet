import { convertJWKToBase64String } from "@revibase/core";
import { type ReadonlyUint8Array } from "gill";
import { CompactSign } from "jose";

const DB_NAME = "device-keys";
const STORE_NAME = "ed25519-keys";
const PRIVATE_KEY_ID = "private-key";
const PUBLIC_KEY_ID = "public-key";

export class DeviceKeyManager {
  private static openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private static async saveToDB(key: string, value: unknown) {
    const db = await DeviceKeyManager.openDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private static async loadFromDB<T>(key: string): Promise<T | undefined> {
    const db = await DeviceKeyManager.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  }

  public static async create(): Promise<string> {
    const keyPair = await crypto.subtle.generateKey(
      { name: "Ed25519" },
      false, // non-exportable private key
      ["sign", "verify"],
    );

    const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const publicKey = convertJWKToBase64String({
      ...jwk,
      alg: "EdDSA",
    });

    try {
      await DeviceKeyManager.saveToDB(PRIVATE_KEY_ID, keyPair.privateKey);
    } catch (err) {
      const isCloneError =
        err instanceof DOMException && err.name === "DataCloneError";
      if (isCloneError) {
        throw new Error(
          "Storing device key in this browser is not supported. Try Chrome or ensure you are in a secure context.",
        );
      }
      throw err;
    }
    await DeviceKeyManager.saveToDB(PUBLIC_KEY_ID, publicKey);

    return publicKey;
  }

  public static async getOrCreateDevicePublickey(): Promise<{
    publicKey: string;
  }> {
    let publicKey = await DeviceKeyManager.loadFromDB<string>(PUBLIC_KEY_ID);
    if (!publicKey) {
      publicKey = await DeviceKeyManager.create();
    }
    return { publicKey };
  }

  public static async sign(
    message: Uint8Array | ReadonlyUint8Array,
  ): Promise<string> {
    const privateKey =
      await DeviceKeyManager.loadFromDB<CryptoKey>(PRIVATE_KEY_ID);
    if (!privateKey) {
      throw new Error(
        "Device key not found. Call DeviceKeyManager.create() first.",
      );
    }

    return await new CompactSign(message as Uint8Array)
      .setProtectedHeader({
        alg: "EdDSA",
      })
      .sign(privateKey);
  }
}
